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
	id: 'timed',
	timing: '*/5 * * * * *', // 5 seconds
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	expires: '1h',
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
