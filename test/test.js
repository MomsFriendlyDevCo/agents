var expect = require('chai').expect;
var mlog = require('mocha-logger');
var pm2 = require('pm2');

describe('Query meta information', function() {
	var agents = require('./setup');
	this.timeout(30 * 1000);

	it('should get a list of available agents', ()=>
		agents.list()
			.then(result => {
				expect(result).to.be.an('array');
				expect(result).to.have.length(3);
				expect(result[0]).to.have.property('id', 'errors');
				expect(result[0]).to.have.property('cacheKey');
				expect(result[1]).to.have.property('id', 'primes');
				expect(result[1]).to.have.property('cacheKey');
				expect(result[2]).to.have.property('id', 'session');
				expect(result[2]).to.have.property('cacheKey');
			})
	)

	// TODO: `get`; should trigger agent
	// TODO: `get`; should return cached results


	describe('getSession', function() {
		beforeEach(function(done) {
			pm2.connect(done);
		});

		/*
		xafterEach(function(done) {
			if (pm2.client_sock.connected == true && pm2.client_sock.closing == false)
				pm2.disconnect(done);
		});
		*/

		it('should return "pending" status when running', function(done) {
			agents.run('session', {complete: false, foo: 'pending'}, {runner: 'pm2', want: 'session'})
				.then(session => new Promise((resolve) => setTimeout(() => resolve(session), 1000)))
				.then(session => agents.getSession(session))
				.then(session => {
					expect(session).to.have.property('status', 'pending');
					expect(session).to.have.property('cacheKey');

					var procName = session.settings.runner.pm2.procName(session.cacheKey);
					pm2.delete(procName, done);
				});
		});

		// TODO: Method to have a pm2 process in "stopped" or "errored" state without crashing this process?
		xit('should return "error" status when stopped', function(done) {
			agents.run('session', {complete: false, foo: 'error'}, {runner: 'pm2', want: 'session'})
				.then(session => new Promise((resolve) => setTimeout(() => resolve(session), 1000)))
				.then(session => agents.getSession(session))
				.then(session => {
					expect(session).to.have.property('status', 'pending');
					expect(session).to.have.property('cacheKey');
					
					var procName = session.settings.runner.pm2.procName(session.cacheKey);
					
					console.log('procName', procName);
					pm2.stop(procName);
					//pm2.delete(procName, done);
					setTimeout(done, 5000);
				});
		});

		// FIXME: May fail with cached result?
		it('should return "complete" status when finished', function() {
			return agents.run('session', {complete: true}, {runner: 'pm2'})
				.then(result => {
					expect(result).to.be.an('array');
					expect(result).to.have.length(2);
				});
		});

		
	});

});
