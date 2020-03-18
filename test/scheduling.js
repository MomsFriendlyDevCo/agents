var expect = require('chai').expect;
var mlog = require('mocha-logger');

describe('Ensuring scheduling is queued', function() {
	var agents = require('./setup');
	this.timeout(10 * 1000);

	beforeEach(() => agents.invalidate('timed'));

	// FIXME: This may pass when re-ran as the scheduled task is not destroyed when invalidated.
	it('should have a result once triggered', (done)=> {
		agents.getSize('timed').then((size) => {
			expect(size).to.be.undefined;
		});
		
		// Wait until after agent should have ran.
		setTimeout(()=>{
			agents.getSize('timed').then((size) => {
				expect(size).to.be.equal(17);
				done();
			});
		}, 7000);
	});

});
