var expect = require('chai').expect;
var mlog = require('mocha-logger');
var pm2 = require('pm2');

var agents = require('./setup');

var wait = function(delay) {
	return new Promise(resolve => setTimeout(resolve, delay));
};

describe('Ensuring scheduling is queued', function() {
	this.timeout(20 * 1000);

	before(()=> {
		agents.settings.runner.calculate = ()=> 'pm2';
		agents.settings.autoInstall = true;
		agents.initCron();
	});

	beforeEach(done => {
		agents.invalidate('timed_errors');
		agents.invalidate('timed0');
		agents.invalidate('timed1');
		pm2.connect(done);
	});

	afterEach(function(done) {
		agents.list().then(list => {
			list.forEach(a => {
				if (!a.timing || a.methods.indexOf('pm2') === -1) return;
				pm2.delete(a.cacheKey, e => {});
			});
		});
		if (pm2.client_sock && pm2.client_sock.connected == true && pm2.client_sock.closing == false)
			pm2.disconnect();
		done();
	});

	it('should have no result immediately after invalidate', ()=> {
		agents.getSize('timed0').then(size =>
			expect(size).to.be.undefined
		);
		agents.getSize('timed1').then(size =>
			expect(size).to.be.undefined
		);
	});
	
	it('should have a result once triggered', async ()=> {
		var init0 = await agents.getSize('timed0');
		expect(init0).to.be.undefined;
		var init1 = await agents.getSize('timed1');
		expect(init1).to.be.undefined;

		await wait(6000);
		var timed0 = await agents.getSize('timed0');
		expect(timed0).to.be.equal(17);
		await wait(6000);
		var timed1 = await agents.getSize('timed1');
		expect(timed1).to.be.equal(17);
	});

});
