var _ = require('lodash');
var async = require('async-chainable');
var debug = require('debug')('agents:inline');
var timestring = require('timestring');
var readable = require('@momsfriendlydevco/readable');

module.exports = {
	id: 'inline',
	exec: session => new Promise((resolve, reject) => {
		try {
			async.run(session.context, session.worker.worker, (err, value) => {
				if (err) {
					debug('inline run error', err);
					// TODO: Store error in special cache key for later accurate status report
					reject(err);
				} else if (session.worker.hasReturn && _.isString(session.worker.expires) && session.worker.expires) { // Stash value with an expiry
					var expiry = new Date(Date.now() + (timestring(session.worker.expires) * 1000));
					session.context.log(`Stashing result with expiry of ${expiry}`);
					var stashStart = new Date();
					session.cacher.set(session.cacheKey, value, expiry).then(() => {
						session.context.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
						resolve(value);
					});
				} else if (session.worker.hasReturn) { // Stash value with no expiry
					session.context.log('Stashing result with no expiry');
					var stashStart = new Date();
					session.cacher.set(session.cacheKey, value).then(() => {
						session.context.log(`Stash write complete in ${readable.relativeTime(stashStart, {formatters: {fallback: '0ms'}})}`);
						resolve(value);
					});
				} else { // Worker finished but has no stashable result
					resolve();
				}
			}, [session.agentSettings, session]);
		} catch(err) {
			debug('inline caught error', err);
			// TODO: Store error in special cache key for later accurate status report
			reject(err.message);
		}
	}),
};
