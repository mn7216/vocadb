﻿import dc = vdb.dataContracts;

function initTagsPage(vm: vdb.viewModels.tags.TagDetailsViewModel) {

	$("#tabs").tabs({
		activate: (event, ui) => {
			if (ui.newTab.data('tab') === "Discussion") {
				vm.comments.initComments();
			}
		}
	});

	$("#editTagLink").button({ disabled: $("#editTagLink").hasClass("disabled"), icons: { primary: 'ui-icon-wrench' } });
	$("#viewVersions").button({ icons: { primary: 'ui-icon-clock' } });
	$("#reportEntryLink").button({ icons: { primary: 'ui-icon-alert' } });

	$("#viewCommentsLink").click(() => {
		var index = $('#tabs ul [data-tab="Discussion"]').index();
		$("#tabs").tabs("option", "active", index);
		return false;
	});

}

function initChart(urlMapper: vdb.UrlMapper, thisTag: string, parent: dc.TagBaseContract, siblings: dc.TagBaseContract[], children: dc.TagBaseContract[]) {

	var tagUrl = (tag: dc.TagBaseContract) => urlMapper.mapRelative("/T/" + tag.id + "/" + tag.urlSlug);
	var tagLink = (tag: dc.TagBaseContract) => {
		var link = '<a href="' + tagUrl(tag) + '">' + tag.name + '</a>';
		return link;
	};

	var tagLinks = (tagList: dc.TagBaseContract[]) => {

		var str = "";
		var links = _.map(tagList, item => tagLink(item));

		for (var i = 0; i < tagList.length; i += 7) {
			
			str += _.reduce<string, string>(_.take(_.drop(links, i), 7), (list, item) => list + ", " + item);

			if (i < tagList.length + 7)
				str += "<br/>";

		}

		return str;

	}

	$('#hierarchyContainer').highcharts({
		credits: { enabled: false },
		chart: {
			backgroundColor: null,
			events: {
				load: function () {

					// Draw the flow chart
					var ren = this.renderer,
						colors = Highcharts.getOptions().colors,
						downArrow = ['M', 0, 0, 'L', 0, 40, 'L', -5, 35, 'M', 0, 40, 'L', 5, 35],
						rightAndDownArrow = ['M', 0, 0, 'L', 70, 0, 'C', 90, 0, 90, 0, 90, 25,
							'L', 90, 80, 'L', 85, 75, 'M', 90, 80, 'L', 95, 75];

					var y = 10;

					if (parent) {

						var parentLab = ren.label("Parent tag:<br/>" + tagLink(parent), 10, y)
							.attr({
								fill: colors[0],
								stroke: 'white',
								'stroke-width': 2,
								padding: 5,
								r: 5
							})
							.css({
								color: 'white'
							})
							.add()
							.shadow(true);

						// Arrow from parent to this tag
						ren.path(downArrow)
							.translate(50, y + 60)
							.attr({
								'stroke-width': 2,
								stroke: colors[3]
							})
							.add();

						if (siblings && siblings.length) {

							// Arrow from parent to siblings
							ren.path(rightAndDownArrow)
								.translate(parentLab.getBBox().x + parentLab.getBBox().width + 20, y + 20)
								.attr({
									'stroke-width': 2,
									stroke: colors[3]
								})
								.add();

							ren.label("Siblings:<br/>" + tagLinks(siblings), 150, y + 115)
								.attr({
									fill: colors[4],
									stroke: 'white',
									'stroke-width': 2,
									padding: 5,
									r: 5
								})
								.css({
									color: 'white'
								})
								.add()
								.shadow(true);
							
						}

						y += 115;

					}

					ren.label("This tag:<br />" + thisTag, 10, y)
						.attr({
							fill: colors[1],
							stroke: 'white',
							'stroke-width': 2,
							padding: 5,
							r: 5
						})
						.css({
							color: 'white'
						})
						.add()
						.shadow(true);

					if (children && children.length) {
						
						// Arrow from this to children
						ren.path(downArrow)
							.translate(50, y + 60)
							.attr({
								'stroke-width': 2,
								stroke: colors[3]
							})
							.add();

						ren.label("Children:<br/>" + tagLinks(children), 10, y + 115)
							.attr({
								fill: colors[4],
								stroke: 'white',
								'stroke-width': 2,
								padding: 5,
								r: 5
							})
							.css({
								color: 'white'
							})
							.add()
							.shadow(true);


					}

				}
			}
		},
        title: {
			text: null,
		}
	});
}