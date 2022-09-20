import { EntryContract } from '@/DataContracts/EntryContract';
import { PVHelper } from '@/Helpers/PVHelper';
import { VideoServiceHelper } from '@/Helpers/VideoServiceHelper';
import { ContentLanguagePreference } from '@/Models/Globalization/ContentLanguagePreference';
import { PVService } from '@/Models/PVs/PVService';
import { SongType } from '@/Models/Songs/SongType';
import { AlbumRepository } from '@/Repositories/AlbumRepository';
import { ReleaseEventRepository } from '@/Repositories/ReleaseEventRepository';
import { SongListRepository } from '@/Repositories/SongListRepository';
import { SongRepository } from '@/Repositories/SongRepository';
import { UserRepository } from '@/Repositories/UserRepository';
import { GlobalValues } from '@/Shared/GlobalValues';
import { ServerSidePagingStore } from '@/Stores/ServerSidePagingStore';
import {
	PlayQueueRepository,
	PlayQueueRepositoryQueryParams,
} from '@/Stores/VdbPlayer/PlayQueueRepository';
import { PlayQueueRepositoryForRatedSongsAdapter } from '@/Stores/VdbPlayer/PlayQueueRepositoryForRatedSongsAdapter';
import { PlayQueueRepositoryForSongListAdapter } from '@/Stores/VdbPlayer/PlayQueueRepositoryForSongListAdapter';
import { PlayQueueRepositoryForSongsAdapter } from '@/Stores/VdbPlayer/PlayQueueRepositoryForSongsAdapter';
import { LocalStorageStateStore } from '@vocadb/route-sphere';
import Ajv, { JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import _ from 'lodash';
import {
	action,
	computed,
	makeObservable,
	observable,
	runInAction,
} from 'mobx';

// TODO: Remove.
export enum EntryType {
	Album = 'Album',
	ReleaseEvent = 'ReleaseEvent',
	Song = 'Song',
}

// TODO: Remove.
export enum EntryStatus {
	Draft = 'Draft',
	Finished = 'Finished',
	Approved = 'Approved',
	Locked = 'Locked',
}

// TODO: Remove.
export enum PVType {
	Original = 'Original',
	Reprint = 'Reprint',
	Other = 'Other',
}

interface PlayQueuePVContract {
	id: number;
	service: PVService;
	pvId: string;
	pvType: PVType;
}

interface PlayQueueAlbumContract {
	entryType: EntryType.Album;
	id: number;
	name: string;
	status: EntryStatus;
	additionalNames: string;
	urlThumb: string;
	pvs: PlayQueuePVContract[];
	artistString: string;
}

interface PlayQueueReleaseEventContract {
	entryType: EntryType.ReleaseEvent;
	id: number;
	name: string;
	status: EntryStatus;
	additionalNames: string;
	urlThumb: string;
	pvs: PlayQueuePVContract[];
}

export interface PlayQueueSongContract {
	entryType: EntryType.Song;
	id: number;
	name: string;
	status: EntryStatus;
	additionalNames: string;
	urlThumb: string;
	pvs: PlayQueuePVContract[];
	artistString: string;
	songType: SongType;
}

export type PlayQueueEntryContract =
	| PlayQueueAlbumContract
	| PlayQueueReleaseEventContract
	| PlayQueueSongContract;

interface PlayQueueItemContract {
	entry: PlayQueueEntryContract;
	pvId: number;
}

export enum PlayQueueRepositoryType {
	RatedSongs = 'RatedSongs',
	SongList = 'SongList',
	Songs = 'Songs',
}

export interface PlayQueueLocalStorageState {
	items?: PlayQueueItemContract[];
	currentIndex?: number;
	repositoryType?: PlayQueueRepositoryType;
	queryParams?: PlayQueueRepositoryQueryParams;
	totalCount?: number;
	page?: number;
}

// TODO: Use single Ajv instance. See https://ajv.js.org/guide/managing-schemas.html.
const ajv = new Ajv({ coerceTypes: true });
addFormats(ajv);

// TODO: Make sure that we compile schemas only once and re-use compiled validation functions. See https://ajv.js.org/guide/getting-started.html.
const schema: JSONSchemaType<PlayQueueLocalStorageState> = require('./PlayQueueLocalStorageState.schema');
const validate = ajv.compile(schema);

export class PlayQueueItem {
	private static nextId = 1;

	public readonly id: number;
	// Do not use the name `selected`. See: https://github.com/SortableJS/react-sortablejs/issues/243.
	@observable public isSelected = false;

	public constructor(
		public readonly entry: PlayQueueEntryContract,
		public readonly pvId: number,
	) {
		makeObservable(this);

		this.id = PlayQueueItem.nextId++;
	}

	public get pv(): PlayQueuePVContract {
		return this.entry.pvs.find((pv) => pv.id === this.pvId)!;
	}

	public static fromContract = ({
		entry,
		pvId,
	}: PlayQueueItemContract): PlayQueueItem => {
		return new PlayQueueItem(entry, pvId);
	};

	public toContract = (): PlayQueueItemContract => {
		return { entry: this.entry, pvId: this.pvId };
	};
}

export class PlayQueueRepositoryFactory {
	public constructor(
		private readonly songListRepo: SongListRepository,
		private readonly songRepo: SongRepository,
		private readonly userRepo: UserRepository,
	) {}

	public create = (
		type: PlayQueueRepositoryType,
	): PlayQueueRepository<PlayQueueRepositoryQueryParams> => {
		switch (type) {
			case PlayQueueRepositoryType.RatedSongs:
				return new PlayQueueRepositoryForRatedSongsAdapter(this.userRepo);

			case PlayQueueRepositoryType.SongList:
				return new PlayQueueRepositoryForSongListAdapter(this.songListRepo);

			case PlayQueueRepositoryType.Songs:
				return new PlayQueueRepositoryForSongsAdapter(this.songRepo);
		}
	};
}

export class AutoplayContext<
	TQueryParams extends PlayQueueRepositoryQueryParams
> {
	public constructor(
		public readonly repositoryType: PlayQueueRepositoryType,
		public readonly queryParams: TQueryParams,
	) {}
}

export enum PlayMethod {
	ClearAndPlay,
	PlayNext,
	AddToPlayQueue,
}

export class PlayQueueStore
	implements LocalStorageStateStore<PlayQueueLocalStorageState> {
	@observable public items: PlayQueueItem[] = [];
	@observable public currentId?: number;

	private autoplayContext?: AutoplayContext<any>;
	private readonly paging = new ServerSidePagingStore(30);

	public constructor(
		private readonly values: GlobalValues,
		private readonly albumRepo: AlbumRepository,
		private readonly eventRepo: ReleaseEventRepository,
		private readonly songRepo: SongRepository,
		private readonly playQueueRepoFactory: PlayQueueRepositoryFactory,
	) {
		makeObservable(this);
	}

	@computed public get isEmpty(): boolean {
		return this.items.length === 0;
	}

	@computed public get hasMultipleItems(): boolean {
		return this.items.length > 1;
	}

	@computed public get currentIndex(): number | undefined {
		return this.currentId !== undefined
			? this.items.findIndex((item) => item.id === this.currentId)
			: undefined;
	}
	public set currentIndex(value: number | undefined) {
		this.currentId =
			value !== undefined
				? this.items[value] /* TODO: Replace with this.items.at(value) */?.id
				: undefined;
	}

	@computed public get hasPreviousItem(): boolean {
		return (
			this.hasMultipleItems &&
			this.currentIndex !== undefined &&
			this.currentIndex > 0
		);
	}

	@computed public get hasMoreItems(): boolean {
		return !this.paging.isLastPage;
	}

	@computed public get hasNextItem(): boolean {
		return (
			this.hasMoreItems ||
			(this.hasMultipleItems &&
				this.currentIndex !== undefined &&
				this.currentIndex < this.items.length - 1)
		);
	}

	@computed public get currentItem(): PlayQueueItem | undefined {
		return this.items.find((item) => item.id === this.currentId);
	}

	@computed public get isLastItem(): boolean {
		return (
			this.currentIndex !== undefined &&
			this.currentIndex === this.items.length - 1
		);
	}

	@computed public get selectedItems(): PlayQueueItem[] {
		return this.items.filter((item) => item.isSelected);
	}

	@computed public get allItemsSelected(): boolean {
		return this.selectedItems.length === this.items.length;
	}
	public set allItemsSelected(value: boolean) {
		for (const item of this.items) {
			item.isSelected = value;
		}
	}

	@computed private get selectedItemsOrAllItems(): PlayQueueItem[] {
		return this.selectedItems.length > 0 ? this.selectedItems : this.items;
	}

	@action public clear = (): void => {
		this.currentIndex = undefined;
		this.items = [];

		this.autoplayContext = undefined;
		this.paging.page = 1;
		this.paging.totalItems = 0;
	};

	@action public unselectAll = (): void => {
		for (const item of this.items) {
			item.isSelected = false;
		}
	};

	@action public setCurrentItem = (item: PlayQueueItem | undefined): void => {
		this.currentId = item?.id;
	};

	@action private setNextItems = (items: PlayQueueItem[]): void => {
		if (this.currentIndex === undefined) return;

		this.items.splice(this.currentIndex + 1, 0, ...items);
	};

	@action public clearAndPlay = (items: PlayQueueItem[]): void => {
		this.clear();

		// currentId must be set before setNextItems is called.
		this.setCurrentItem(items[0]);

		this.setNextItems(items);
	};

	public playNext = (items: PlayQueueItem[]): void => {
		if (this.isEmpty) {
			this.clearAndPlay(items);
			return;
		}

		this.setNextItems(items);
	};

	public playSelectedItemsNext = (): void => {
		const items = this.selectedItemsOrAllItems;
		this.playNext(
			items.map((item) => PlayQueueItem.fromContract(item.toContract())),
		);

		this.unselectAll();
	};

	@action public addToPlayQueue = (items: PlayQueueItem[]): void => {
		if (this.isEmpty) {
			this.clearAndPlay(items);
			return;
		}

		this.items.push(...items);
	};

	public addSelectedItemsToPlayQueue = (): void => {
		const items = this.selectedItemsOrAllItems;
		this.addToPlayQueue(
			items.map((item) => PlayQueueItem.fromContract(item.toContract())),
		);

		this.unselectAll();
	};

	public play = (method: PlayMethod, items: PlayQueueItem[]): void => {
		switch (method) {
			case PlayMethod.ClearAndPlay:
				this.clearAndPlay(items);
				break;

			case PlayMethod.PlayNext:
				this.playNext(items);
				break;

			case PlayMethod.AddToPlayQueue:
				this.addToPlayQueue(items);
				break;
		}
	};

	private static primaryPV = (
		pvs: PlayQueuePVContract[],
		autoplay: boolean,
	): PlayQueuePVContract | undefined => {
		const pv = PVHelper.primaryPV(pvs, autoplay);

		return pv
			? {
					id: pv.id ?? 0,
					service: pv.service,
					pvId: pv.pvId,
					pvType: pv.pvType as PVType /* TODO: enum */,
			  }
			: undefined;
	};

	private static createItemsFromSongs = (
		songs: PlayQueueSongContract[],
	): PlayQueueItem[] => {
		return songs
			.map((song) => {
				const primaryPV = PlayQueueStore.primaryPV(song.pvs, true);
				return primaryPV ? new PlayQueueItem(song, primaryPV.id) : undefined;
			})
			.filter((item) => !!item)
			.map((item) => item!);
	};

	private getAlbumAndSongs = async ({
		id,
		lang,
	}: {
		id: number;
		lang: ContentLanguagePreference;
	}): Promise<{
		album: PlayQueueAlbumContract;
		songs: PlayQueueSongContract[];
	}> => {
		const album = await this.albumRepo.getOneWithComponents({
			id: id,
			lang: lang,
			fields: PlayQueueRepository.albumOptionalFields,
			songFields: PlayQueueRepository.songOptionalFields,
		});

		return {
			album: {
				entryType: EntryType.Album,
				id: album.id,
				name: album.name,
				status: album.status as EntryStatus /* TODO: enum */,
				additionalNames: album.additionalNames,
				urlThumb: album.mainPicture?.urlThumb ?? '',
				pvs:
					album.pvs?.map((pv) => ({
						id: pv.id ?? 0,
						service: pv.service,
						pvId: pv.pvId,
						pvType: pv.pvType as PVType /* TODO: enum */,
					})) ?? [],
				artistString: album.artistString,
			},
			songs:
				album.tracks
					?.filter(({ song }) => !!song)
					.map((track) => track.song!)
					.map((song) => ({
						entryType: EntryType.Song,
						id: song.id,
						name: song.name,
						status: song.status as EntryStatus /* TODO: enum */,
						additionalNames: song.additionalNames,
						urlThumb: song.mainPicture?.urlThumb ?? '',
						pvs:
							song.pvs?.map((pv) => ({
								id: pv.id ?? 0,
								service: pv.service,
								pvId: pv.pvId,
								pvType: pv.pvType as PVType /* TODO: enum */,
							})) ?? [],
						artistString: song.artistString,
						songType: song.songType,
					})) ?? [],
		};
	};

	private loadItemsFromAlbum = async (
		entry: EntryContract,
	): Promise<PlayQueueItem[]> => {
		const { album, songs } = await this.getAlbumAndSongs({
			id: entry.id,
			lang: this.values.languagePreference,
		});

		const primaryPV = PlayQueueStore.primaryPV(album.pvs, true);
		return [
			...(primaryPV ? [new PlayQueueItem(album, primaryPV.id)] : []),
			...PlayQueueStore.createItemsFromSongs(songs),
		];
	};

	private getEvent = async ({
		id,
	}: {
		id: number;
	}): Promise<PlayQueueReleaseEventContract> => {
		const event = await this.eventRepo.getOne({
			id: id,
			fields: PlayQueueRepository.eventOptionalFields,
		});

		return {
			entryType: EntryType.ReleaseEvent,
			id: event.id,
			name: event.name,
			status: event.status as EntryStatus /* TODO: enum */,
			additionalNames: event.additionalNames ?? '',
			urlThumb: event.mainPicture?.urlThumb ?? '',
			pvs:
				event.pvs?.map((pv) => ({
					id: pv.id ?? 0,
					service: pv.service,
					pvId: pv.pvId,
					pvType: pv.pvType as PVType /* TODO: enum */,
				})) ?? [],
		};
	};

	private loadItemsFromEvent = async (
		entry: EntryContract,
	): Promise<PlayQueueItem[]> => {
		const event = await this.getEvent({
			id: entry.id,
		});

		const primaryPV = PlayQueueStore.primaryPV(event.pvs, true);
		return primaryPV ? [new PlayQueueItem(event, primaryPV.id)] : [];
	};

	private getSong = async ({
		id,
		lang,
	}: {
		id: number;
		lang: ContentLanguagePreference;
	}): Promise<PlayQueueSongContract> => {
		const song = await this.songRepo.getOneWithComponents({
			id: id,
			lang: lang,
			fields: PlayQueueRepository.songOptionalFields,
		});

		return {
			entryType: EntryType.Song,
			id: song.id,
			name: song.name,
			status: song.status as EntryStatus /* TODO: enum */,
			additionalNames: song.additionalNames,
			urlThumb: song.mainPicture?.urlThumb ?? '',
			pvs:
				song.pvs?.map((pv) => ({
					id: pv.id ?? 0,
					service: pv.service,
					pvId: pv.pvId,
					pvType: pv.pvType as PVType /* TODO: enum */,
				})) ?? [],
			artistString: song.artistString,
			songType: song.songType,
		};
	};

	private loadItemsFromSong = async (
		entry: EntryContract,
	): Promise<PlayQueueItem[]> => {
		const song = await this.getSong({
			id: entry.id,
			lang: this.values.languagePreference,
		});

		return PlayQueueStore.createItemsFromSongs([song]);
	};

	private loadItems = async (
		entry: EntryContract,
	): Promise<PlayQueueItem[]> => {
		switch (entry.entryType) {
			case EntryType[EntryType.Album]:
				return this.loadItemsFromAlbum(entry);

			case EntryType[EntryType.ReleaseEvent]:
				return this.loadItemsFromEvent(entry);

			case EntryType[EntryType.Song]:
				return this.loadItemsFromSong(entry);

			default:
				throw new Error(`Unsupported entry type: ${entry.entryType}`);
		}
	};

	public loadItemsAndPlay = async (
		entry: EntryContract,
		method: PlayMethod,
	): Promise<void> => {
		const items = await this.loadItems(entry);

		this.play(method, items);
	};

	@action public previous = (): void => {
		if (this.currentIndex === undefined) return;

		if (!this.hasPreviousItem) return;

		this.currentIndex--;
	};

	private updateResults = async (getTotalCount: boolean): Promise<void> => {
		if (!this.autoplayContext) return;
		const { repositoryType, queryParams } = this.autoplayContext;

		const playQueueRepo = this.playQueueRepoFactory.create(repositoryType);
		const pagingProps = this.paging.getPagingProperties(getTotalCount);
		const { items: songs, totalCount } = await playQueueRepo.getSongs({
			lang: this.values.languagePreference,
			pagingProps: pagingProps,
			pvServices: VideoServiceHelper.autoplayServices,
			queryParams: queryParams,
		});

		const songItems = PlayQueueStore.createItemsFromSongs(songs);

		runInAction(() => {
			this.items.push(...songItems);

			if (getTotalCount) this.paging.totalItems = totalCount;
		});
	};

	public updateResultsWithoutTotalCount = (): Promise<void> => {
		return this.updateResults(false);
	};

	public updateResultsWithTotalCount = (): Promise<void> => {
		return this.updateResults(true);
	};

	public loadMore = async (): Promise<void> => {
		if (!this.hasMoreItems) return;

		this.paging.nextPage();

		await this.updateResultsWithoutTotalCount();
	};

	@action public next = async (): Promise<void> => {
		if (this.currentIndex === undefined) return;

		if (!this.hasNextItem) return;

		if (this.isLastItem && this.hasMoreItems) {
			await this.loadMore();
		}

		this.currentIndex++;
	};

	@action public goToFirst = (): void => {
		if (this.currentIndex === undefined) return;

		this.currentIndex = 0;
	};

	@action public removeFromPlayQueue = async (
		items: PlayQueueItem[],
	): Promise<void> => {
		// Note: We need to remove the current (if any) and other (previous and/or next) items separately,
		// so that the current index can be set properly even if the current item was removed.

		// Capture the current item.
		const { currentItem } = this;

		// First, remove items that are not equal to the current one.
		_.pull(this.items, ...items.filter((item) => item !== currentItem));

		// Capture the current index.
		const { currentIndex, isLastItem } = this;

		// Then, remove the current item if any.
		_.pull(
			this.items,
			items.find((item) => item === currentItem),
		);

		// If the current item differs from the captured one, then it means that the current item was removed from the play queue.
		if (this.currentItem !== currentItem) {
			if (isLastItem) {
				if (this.hasMoreItems) {
					await this.loadMore();

					// Set the current index to the captured one.
					this.currentIndex = currentIndex;
				} else {
					// Start over the playlist from the beginning.
					this.goToFirst();
				}
			} else {
				// Set the current index to the captured one.
				this.currentIndex = currentIndex;
			}
		}
	};

	public removeSelectedItemsFromPlayQueue = async (): Promise<void> => {
		await this.removeFromPlayQueue(this.selectedItemsOrAllItems);

		this.unselectAll();
	};

	@action public startAutoplay = async <
		TQueryParams extends PlayQueueRepositoryQueryParams
	>(
		autoplayContext: AutoplayContext<TQueryParams>,
	): Promise<void> => {
		this.clear();

		this.autoplayContext = autoplayContext;

		await this.updateResultsWithTotalCount();

		this.setCurrentItem(this.items[0]);
	};

	@computed.struct public get localStorageState(): PlayQueueLocalStorageState {
		return {
			items: this.items.map((item) => item.toContract()),
			currentIndex: this.currentIndex,
			repositoryType: this.autoplayContext?.repositoryType,
			queryParams: this.autoplayContext?.queryParams,
			totalCount: this.paging.totalItems,
			page: this.paging.page,
		};
	}
	public set localStorageState(value: PlayQueueLocalStorageState) {
		this.items = value.items?.map(PlayQueueItem.fromContract) ?? [];
		this.currentIndex = value.currentIndex;
		this.autoplayContext =
			value.repositoryType && value.queryParams
				? new AutoplayContext(value.repositoryType, value.queryParams)
				: undefined;
		this.paging.totalItems = value.totalCount ?? 0;
		this.paging.page = value.page ?? 1;
	}

	public validateLocalStorageState = (
		localStorageState: any,
	): localStorageState is PlayQueueLocalStorageState => {
		return validate(localStorageState);
	};
}
