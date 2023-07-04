var exec = require('child_process').exec;
var expect = require('chai').expect;
var mlog = require('mocha-logger');

var agents = require('./setup');
describe('Catching errors from within an agent', function() {
	this.timeout(30 * 1000);

	describe('Runner: inline', function() {

		it('should run the error example with a successful result', ()=>
			agents.run('errors', {payload: {example: 100}}, {runner: 'inline'})
				.then(v => expect(v).to.be.deep.equal({example: 100}))
		);

		it('should fail when an error is thrown', ()=>
			agents.run('errors', {throw: true}, {runner: 'inline'})
				.then(()=> expect.fail)
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		it('should fail when a promise rejection occurs', ()=>
			agents.run('errors', {reject: true}, {runner: 'pm2'})
				.then(()=> expect.fail)
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);
	});

	describe('Runner: pm2', function() {

		it('should run the error example with a successful result', ()=>
			agents.run('errors', {payload: {example: 100}}, {runner: 'pm2'})
				.then(v => expect(v).to.be.deep.equal({example: 100}))
		);

		it('should fail when an error is thrown', ()=>
			agents.run('errors', {throw: true}, {runner: 'pm2'})
				.then(()=> expect.fail)
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		it('should fail when a promise rejection occurs', ()=>
			agents.run('errors', {reject: true}, {runner: 'pm2'})
				.then(()=> expect.fail)
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		it('should error with non-zero exit codes', ()=>
			agents.run('errors', {exitCode: 100}, {runner: 'pm2'})
				.then(()=> expect.fail)
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		// FIXME: Fragile test, timing can be off
		it('should error if the process gets stopped in PM2', done => {
			agents.run('errors', {wait: 3000}, {runner: 'pm2'})
				.then(()=> done(new Error('should not be successful')))
				.catch(e => {
					expect(e).to.be.a('string');
					done();
				})

			setTimeout(()=> {
				mlog.log('Run: pm2 stop all');
				exec('pm2 stop all', {},  err => {
					if (err) throw new Error(err);
				});
			}, 250); // Tell PM2 to stop all processes after 250ms
		});

		it('should error if the process gets deleted in PM2', done => {
			agents.run('errors', {wait: 3000}, {runner: 'pm2'})
				.then(()=> done(new Error('should not be successful')))
				.catch(e => {
					expect(e).to.be.a('string');
					done();
				})

			setTimeout(()=> {
				mlog.log('Run: pm2 delete all');
				exec('pm2 delete all', {},  err => {
					if (err) throw new Error(err);
				})
			}, 250); // Tell PM2 to delete all processes after 250ms
		});

		it('should error if the process gets killed by a 3rd party', done => {
			agents.run('errors', {wait: 10000}, {runner: 'pm2'})
				.then(()=> done(new Error('should not be successful')))
				.catch(e => {
					expect(e).to.be.a('string');
					done();
				})

			setTimeout(()=> {
				mlog.log('Run: kill');
				exec('bash -c "ps -aeo \'%p,%a\' | grep agents.js | cut -d, -f1 | xargs kill"');
			}, 250); // Kill agent process after 250ms
		});

		it.skip('should error PM2 gets killed', done => { // This seems to be fatal no matter what we do
			agents.run('errors', {wait: 3000}, {runner: 'pm2'})
				.then(()=> done(new Error('should not be successful')))
				.catch(e => {
					expect(e).to.be.a('string');
					done();
				})

			setTimeout(()=> exec('pm2 kill'), 250); // Tell PM2 to kill itself after 250ms
		});
	});
});
