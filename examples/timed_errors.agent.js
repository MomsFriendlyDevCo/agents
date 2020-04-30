/**
* Example agent to generate various error states
*
* @param {Object} [settings] Settings
* @param {number} [settings.throw=false] Throw an error within the agent
* @param {number} [settings.finish=false] Return an error via finish callback
* @param {number} [settings.exit=false] Exit process
*
* @example Throw an error
* agents.get('errors', {throw: true}).catch(err => { ... })
*/
var _ = require('lodash');

module.exports = {
	id: 'timed_errors',
	timing: '*/2 * * * * *', // 2 seconds
	hasReturn: true,
	methods: ['pm2'],
	expires: '3s',
	worker: function(finish, settings) {
		var agent = this;

		_.defaults(settings, {
			throw: false,
			exitCode: 1,
			wait: 1000,
			payload: {foo: 123},
		});

		if (settings.throw)
			throw new Error('ERROR');

		if (settings.reject)
			return Promise.reject('ERROR');

		if (settings.exitCode > 0)
			return process.exit(settings.exitCode);

		agent.log('Waiting', settings.wait + 'ms', 'before exiting');
		setTimeout(()=> {
			agent.log('Exiting with payload', settings.payload);
			finish(null, settings.payload);
		}, settings.wait);
	},
};
