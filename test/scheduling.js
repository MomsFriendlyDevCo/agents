var expect = require('chai').expect;
var mlog = require('mocha-logger');

var agents = require('./setup');

var wait = function(delay) {
	return new Promise(resolve => setTimeout(resolve, delay));
};

describe('Ensuring scheduling is queued', function() {
	this.timeout(20 * 1000);

	before(()=> {
		agents.settings.runner.calculate = ()=> 'pm2';
	});

	beforeEach(() => {
		agents.invalidate('timed_errors');
		agents.invalidate('timed0');
		agents.invalidate('timed1');
	});

	it('should have no result immediately after invalidate', ()=> {
		agents.getSize('timed0').then(size =>
			expect(size).to.be.undefined
		);
		agents.getSize('timed1').then(size =>
			expect(size).to.be.undefined
		);
	});
	
	// FIXME: This may pass when re-ran as the scheduled task is not destroyed when invalidated.
	it('should have a result once triggered', async ()=> {
		await wait(6000);
		var timed0 = await agents.getSize('timed0');
		expect(timed0).to.be.equal(17);
		await wait(6000);
		var timed1 = await agents.getSize('timed1');
		expect(timed1).to.be.equal(17);
	});

});
