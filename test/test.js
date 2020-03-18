var expect = require('chai').expect;
var mlog = require('mocha-logger');
var pm2 = require('pm2');

var agents = require('./setup');
describe('Query meta information', function() {
	this.timeout(30 * 1000);

	it('should get a list of available agents', ()=>
		agents.list()
			.then(result => {
				expect(result).to.be.an('array');
				expect(result).to.have.length(4);
				// FIXME: Array order is not guarenteed
				//expect(result[0]).to.have.property('id', 'errors');
				expect(result[0]).to.have.property('cacheKey');
				//expect(result[1]).to.have.property('id', 'primes');
				expect(result[1]).to.have.property('cacheKey');
				//expect(result[2]).to.have.property('id', 'session');
				expect(result[2]).to.have.property('cacheKey');
				//expect(result[2]).to.have.property('id', 'scheduling');
				expect(result[3]).to.have.property('cacheKey');
			})
	)

	// TODO: `get`; should trigger agent
	// TODO: `get`; should return cached results

	describe('getSession', function() {
		beforeEach(function(done) {
			pm2.connect(done);
		});

		afterEach(function(done) {
			if (pm2.client_sock && pm2.client_sock.connected == true && pm2.client_sock.closing == false)
				pm2.disconnect();
			done();
		});

		// FIXME: `pm2.delete` is not behaving...
		xit('should return "pending" status when running', function(done) {
			agents.run('session', {complete: false, foo: 'pending'}, {runner: 'pm2', want: 'session'})
				.then(session => agents.getSession(session))
				.then(session => {
					expect(session).to.have.property('status', 'pending');
					expect(session).to.have.property('cacheKey');

					// Give process a moment to actually start
					setTimeout(() => {
						var procName = session.settings.runner.pm2.procName(session.cacheKey);
						// FIXME: Hangs here if process is already gone or does not yet exist?
						pm2.delete(procName, done);
					}, 2000);
				})
		});

		// TODO: Method to have a pm2 process in "stopped" or "errored" state without crashing this process?
		xit('should return "error" status when stopped', function(done) {
			agents.run('session', {complete: false, foo: 'error'}, {runner: 'pm2', want: 'session'})
				.then(session => agents.getSession(session))
				.then(session => {
					expect(session).to.have.property('status', 'pending');
					expect(session).to.have.property('cacheKey');

					return new Promise(resolve => {
						// Give process a moment to actually start
						setTimeout(() => {
							// FIXME: Catch when process not found?
							//var procName = session.settings.runner.pm2.procName(session.cacheKey);
							//pm2.stop(procName, () => {
								mlog.log('session.status', session.status);
								setTimeout(() => resolve(session), 2000);
							//});
						}, 2000);
					});
				}).then(session => {
					expect(session).to.have.property('status', 'error');
					expect(session).to.have.property('cacheKey');

					var procName = session.settings.runner.pm2.procName(session.cacheKey);
					pm2.delete(procName, done);
				})
		});

		// FIXME: May fail with cached result? Add an epoch to the settings so hash is unique?
		it('should return "complete" status when finished', function() {
			return agents.run('session', {complete: true}, {runner: 'pm2'})
				.then(result => {
					expect(result).to.be.an('array');
					expect(result).to.have.length(2);
				});
		});

		
	});

});
