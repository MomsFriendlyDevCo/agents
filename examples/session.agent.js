/**
* Example agent to test pm2 process status
*
* @param {Object} [settings] Settings
* @param {number} [settings.complete=true] Allow the agent to finish
*
* @example Retrieve a mock result
* agents.get('session', {complete: true}).then(result => { ... })
*/
var _ = require('lodash');

module.exports = {
	id: 'session',
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	expires: '1h',
	worker: function(finish, settings) {
		var agent = this;

		_.defaults(settings, {
			complete: true,
		});

		if (settings.complete)
			return finish(null, ['foo', 'bar']);

		var cnt = 0;
		setInterval(function() {
			agent.log('Running', cnt++);
		}, 1000);

	},
};
