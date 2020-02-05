/**
* Example agent to demonstrate logging
*
* @param {Object} [settings] Settings to use when calculating
* @param {number} [settings.delay=10] The number of milliseonds to wait between each number scan
* @param {number} [settings.limit=1000] The highest number to calculate to
*
* @example Test logging
* agents.get('logging').then(result => { ... })
*/
var _ = require('lodash');

module.exports = {
	id: 'logging',
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	expires: '1h',
	worker: function(finish, settings) {
		var agent = this;

		agent.log(null);
		finish();
	},
};
