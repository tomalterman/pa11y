/*globals document, location, window */
'use strict';

// Dependencies
var async = require('async');
var phantom = require('phantom');
var buildResult = require('./results').build;
var url = require('./url');
var wait = require('./phantom-wait').wait;

// Sniff a page
exports.sniff = function (opts, reporter, callback) {
	var self = {
		url: url.appendQuery(url.sanitize(opts.url), {__pa11y_standard: opts.standard}),
		standard: opts.standard,
		reporter: reporter,
		timeout: opts.timeout
	};
	async.waterfall([
		begin.bind(null, self),
		createBrowser,
		createPage,
		openUrl,
		setupVars,
		loadScript,
		runSniffer,
		getMessages
	], function (err, result) {
		end(err, result, callback);
	});
};

// Begin
function begin (self, next) {
	if (self.reporter.begin) {
		self.reporter.begin();
	}

	// Timeout
	self.timer = setTimeout(function () {
		if (self.browser) {
			self.browser.exit();
		}
		self.reporter.error('PhantomJS timeout');
		self.reporter.end();
		process.exit(1);
	}, self.timeout);

	next(null, self);
}

// Create a browser
function createBrowser (self, next) {
	phantom.create(function (browser) {
		self.browser = browser;
		next(null, self);
	});
}

// Create a page
function createPage (self, next) {
	self.browser.createPage(function (page) {
		self.page = page;
		next(null, self);
	});
}

// Open the URL
function openUrl (self, next) {
	self.reporter.log('Loading page...');
	self.page.open(self.url, function (status) {
		if (status === 'fail') {
			next(new Error('URL could not be loaded'), self);
		} else {
			next(null, self);
		}
	});
}

// Set up required variables in our page
function setupVars (self, next) {
	self.page.evaluate(function () {

		window.__pa11y = {
			isComplete: false
		};

		// parse parameters from query (really really prone to bad things)
		window.__pa11y.vars = (function () {
			var query = location.search.replace(/^\?/, '');
			var params = {};
			query.split('&').forEach(function (pair) {
				var parts = pair.split('=');
				params[decodeURIComponent(parts.shift())] = decodeURIComponent(parts.join('='));
			});
			return params;
		} ());

	}, function () {
		next(null, self);
	});
}

// Load the script
function loadScript (self, next) {
	self.reporter.log('Loading HTML CodeSniffer...');
	self.page.evaluate(function () {
		var script = document.createElement('script');
		script.src = 'http://squizlabs.github.com/HTML_CodeSniffer/build/HTMLCS.js';
		document.head.appendChild(script);
	}, function () {
		wait(self.page, function () {
			return (typeof window.HTMLCS !== 'undefined');
		}, function () {
			next(null, self);
		});
	});
}

// Run the sniffer
function runSniffer (self, next) {
	self.reporter.log('Running HTML CodeSniffer...');
	self.page.evaluate(function () {
		window.HTMLCS.process(window.__pa11y.vars.__pa11y_standard, window.document, function () {
			window.__pa11y.isComplete = true;
		});
	}, function () {
		wait(self.page, function () {
			return (window.__pa11y.isComplete === true);
		}, function () {
			next(null, self);
		});
	});
}

// Get messages
function getMessages (self, next) {
	self.page.evaluate(function () {
		return window.HTMLCS.getMessages();
	}, function (messages) {
		clearTimeout(self.timer);
		self.messages = messages;
		next(null, self);
	});
}

// End
function end (err, self, callback) {
	if (self.browser) {
		self.browser.exit();
	}
	if (err) {
		self.reporter.error(err.message);
	} else {
		self.reporter.log('Done');
		self.reporter.handleResult(buildResult(self.messages));
	}
	if (self.reporter.end) {
		self.reporter.end();
	}
	callback(err, self);
}
