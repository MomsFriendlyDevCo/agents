/**
* Example agent to run at a scheduled time
*
* @param {Object} [settings] Settings
*
* @example Returns the cached result
* agents.get('timed').catch(err => { ... })
*/
var _ = require('lodash');

module.exports = {
	id: 'timed1',
	timing: '*/10 * * * * *', // 10 seconds
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	//expires: '11s',
	worker: function(finish, settings) {
		var agent = this;

		_.defaults(settings, {
		});

		var payload = [{
			status: 'ok'
		}];

		agent.log('Exiting with payload', JSON.stringify(payload));
		finish(null, payload);
	},
};
