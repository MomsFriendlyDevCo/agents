var _ = require('lodash');
var async = require('async-chainable');
var timestring = require('timestring');
var readable = require('@momsfriendlydevco/readable');

module.exports = {
	id: 'inline',
	exec: session => new Promise((resolve, reject) => {
		async.run(session.context, session.worker.worker, (err, value) => {
			if (err) {
				reject(err)
			} else if (_.isString(session.worker.expires) && session.worker.expires) { // Stash value with an expiry
				var expiry = new Date(Date.now() + (timestring(session.worker.expires) * 1000));
				session.context.log(`Stashing result with expiry of ${expiry}`);
				var stashStart = new Date();
				session.cacher.set(session.cacheKey, value, expiry, err => {
					session.context.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
					resolve(value);
				});
			} else { // Stash value with no expiry
				session.context.log('Stashing result with no expiry');
				var stashStart = new Date();
				session.cacher.set(session.cacheKey, value, err => {
					session.context.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
					resolve(value);
				});
			}
		}, [session.agentSettings, session]);
	}),
};
