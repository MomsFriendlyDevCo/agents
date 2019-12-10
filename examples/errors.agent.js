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
	id: 'errors',
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	expires: '1h',
	worker: function(finish, settings) {
		var agent = this;

		_.defaults(settings, {
			throw: false,
			finish: false,
			exit: false,
		});

		if (settings.throw)
			throw new Error('ERROR');

		if (settings.finish)
			return finish('ERROR', []);

		if (settings.exit)
			process.exit(1);

	},
};
