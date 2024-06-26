using System.Runtime.Serialization;
using VocaDb.Model.Domain.Globalization;
using VocaDb.Model.Domain.Security;
using VocaDb.Model.Domain.Users;

namespace VocaDb.Model.DataContracts.Users;

[DataContract(Namespace = Schemas.VocaDb)]
public sealed record ServerOnlyUserWithPermissionsForApiContract
{
	[DataMember]
	public bool Active { get; init; }

	[DataMember]
	public Guid[] AdditionalPermissions { get; set; }

	[DataMember]
	public Guid[] EffectivePermissions { get; init; }

	[DataMember]
	public string Email { get; init; }

	[DataMember]
	public UserGroupId GroupId { get; init; }

	[DataMember]
	public int Id { get; set; }

	[DataMember]
	public string Name { get; set; }

	/// <summary>
	/// List of artist entries owned by the user. Cannot be null.
	/// </summary>
	[DataMember]
	public ArtistForUserForApiContract[] OwnedArtistEntries { get; init; }

	[DataMember]
	public bool Poisoned { get; init; }

	[DataMember]
	public bool Supporter { get; init; }

	public ServerOnlyUserWithPermissionsForApiContract()
	{
		AdditionalPermissions = Array.Empty<Guid>();
		EffectivePermissions = Array.Empty<Guid>();
		Email = string.Empty;
		Name = string.Empty;
		OwnedArtistEntries = Array.Empty<ArtistForUserForApiContract>();
	}

	public ServerOnlyUserWithPermissionsForApiContract(
		User user,
		ContentLanguagePreference languagePreference,
		IUserPermissionContext permissionContext,
		bool getPublicCollection = false
	)
	{
		Active = user.Active;
		AdditionalPermissions = user.AdditionalPermissions.PermissionTokens
			.Select(permissionToken => permissionToken.Id)
			.ToArray();
		EffectivePermissions = user.EffectivePermissions.PermissionTokens
			.Select(permissionToken => permissionToken.Id)
			.ToArray();
		Email = user.Email;
		GroupId = user.GroupId;
		Id = user.Id;
		Name = user.Name;
		OwnedArtistEntries = user.OwnedArtists
			.Select(a => new ArtistForUserForApiContract(
				artistForUser: a,
				languagePreference: languagePreference,
				permissionContext,
				thumbPersister: null,
				includedFields: Artists.ArtistOptionalFields.None
			))
			.ToArray();
		Poisoned = user.Options.Poisoned;
		Supporter = user.Options.Supporter;
	}
}
