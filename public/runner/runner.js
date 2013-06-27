/** =========================================================================
 * JS Bin Runner
 * ========================================================================== */

/**
 * Polyfills
 */

var prependChild = function(elem, child) { elem.insertBefore(child, elem.firstChild); };
var addEvent = function(elem, event, fn) {
  if (elem.addEventListener) {
    elem.addEventListener(event, fn, false);
  } else {
    elem.attachEvent("on" + event, function() {
      // set the this pointer same as addEventListener when fn is called
      return(fn.call(elem, window.event));
    });
  }
};
if (!window.location.origin) window.location.origin = window.location.protocol+"//"+window.location.host;
try {
  console.log('runner');
} catch (e) {
  window.console = {
    log: function () {},
    info: function () {},
    error: function () {}
  };
}

/** =========================================================================
 * Processor
 * Modify the prepared source ready to be written to an iframe
 * ========================================================================== */

var processor = (function () {

  var processor = {};

  processor.blockingMethods = {
    kill: '<script>try{window.open=function(){};window.print=function(){};window.alert=function(){};window.prompt=function(){};window.confirm=function(){};}catch(e){}</script>',
    restore: '<script>try{delete window.print;delete window.alert;delete window.prompt;delete window.confirm;delete window.open;}catch(e){}</script>',
  };

  /**
   * Grab the doctype from a string.
   *
   * Returns an object with doctype and tail keys.
   */
  processor.getDoctype = (function () {
    // Cached regex
    // [\s\S] matches multiline doctypes
    var regex = /<!doctype [\s\S]*?>/i;
    return function (str) {
      var doctype = (str.match(regex) || [''])[0],
          tail = str.substr(doctype.length);
      return {
        doctype: doctype,
        tail: tail
      };
    };
  }());

  processor.debug = function (source) {
    return '<pre>' + source.replace(/[<>&]/g, function (m) {
      if (m == '<') return '&lt;';
      if (m == '>') return '&gt;';
      if (m == '"') return '&quot;';
    }) + '</pre>';
  };

  /**
   * Render – build the final source code to be written to the iframe. Takes
   * the original source and an options object.
   */
  processor.render = function (source, options) {

    options = options || [];
    source = source || '';


    var combinedSource = [];

    // Strip autofocus from the markup, preventing the focus switching out of
    // the editable area.
    source = source.replace(/(<.*?\s)(autofocus)/g, '$1');

    // Make sure the doctype is the first thing in the source
    var doctypeObj = processor.getDoctype(source),
        doctype = doctypeObj.doctype;
    source = doctypeObj.tail;
    combinedSource.push(doctype);

    // Kill the blocking functions
    // IE requires that this is done in the script, rather than off the window
    // object outside of the doc.write.
    if (options.withAlerts !== true) {
      combinedSource.push(processor.blockingMethods.kill);
    }

    // Push the source, split from the doctype above.
    combinedSource.push(source);

    // Kill the blocking functions
    // IE requires that this is done in the script, rather than off the window
    // object outside of the doc.write.
    if (options.withAlerts !== true) {
      combinedSource.push(processor.blockingMethods.restore);
    }

    if (options.debug) {
      return processor.debug(combinedSource.join('\n'));
    }

    return combinedSource.join('\n');

  };

  return processor;

}());

/** ============================================================================
 * Sandbox
 * Handles creating and insertion of dynamic iframes
 * ========================================================================== */

var sandbox = (function () {

  var sandbox = {};

  /**
   * Save the target container element, plus the old and active iframes.
   */
  sandbox.target = null;
  sandbox.old = null;
  sandbox.active = null;

  /**
   * Create a new sandboxed iframe.
   */
  sandbox.create = function () {
    var iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-forms allow-pointer-lock allow-popups allow-same-origin allow-scripts');
    iframe.setAttribute('frameBorder', '0');
    return iframe;
  };

  /**
   * Add a new iframe to the page and wait until it has loaded to call the
   * requester back. Also wait until the new iframe has loaded before removing
   * the old one.
   */
  sandbox.use = function (iframe, done) {
    if (!sandbox.target) throw new Error("Sandbox has no target element.");
    sandbox.old = sandbox.active;
    sandbox.active = iframe;
    prependChild(sandbox.target, iframe);
    // setTimeout allows the iframe to be rendered before other code runs,
    // allowing us access to the calculated properties like innerWidth.
    setTimeout(done || '', 0);
    // Wait until the new iframe has loaded to remove the old one
    addEvent(iframe, 'load', function () {
      if (sandbox.old && sandbox.old.parentNode) {
        sandbox.old.parentNode.removeChild(sandbox.old);
      }
    });
  };

  return sandbox;

}());

/** ============================================================================
 * JS Bin Runner
 * Accepts incoming postMessage events and updates a live iframe accordingly.
 * ========================================================================== */

var runner = (function () {

  var runner = {};

  /**
   * Store what parent origin *should* be
   * TODO this should allow anything if x-origin protection should be disabled
   */
  runner.parentOrigin = window.location.origin.replace('run.', '');

  /**
   * Log error messages, indicating that it's from the runner.
   * TODO proxy these up to the parent
   */
  runner.error = function () {
    window.console.error.apply(console, ['Runner:'].concat([].slice.call(arguments)));
  };

  /**
   * Handle all incoming postMessages to the runner
   */
  runner.handleMessage = function (event) {
    if (event.origin !== runner.parentOrigin) {
      return runner.error('Message disallowed, incorrect origin:', event.origin);
    }
    if (typeof runner[event.data.type] !== 'function') {
      return runner.error('No matching event handler:', event.data.type);
    }
    try {
      runner[event.data.type](event.data.data);
    } catch (e) {
      runner.error(e.message);
    }
  };

  /**
   * Render a new preview iframe using the posted source
   */
  runner.render = function (data) {
    var iframe = sandbox.create(data.options);
    sandbox.use(iframe, function () {
      var doc = iframe.contentDocument || iframe.contentWindow.document;
          win = doc.defaultView || doc.parentWindow;
      // Process the source according to the options passed in
      var source = processor.render(data.source, data.options);
      doc.open();
      // Only one doc.write. IE crashes if you have lots.
      doc.write(source);
      doc.close();
    });
  };

  return runner;

}());

window.onload = function () {

  /**
   * Live rendering, basic mode.
   * Fallback - load the bin into a new iframe, and let it keep itself up
   * to date using event stream.
   */
  if (!window.postMessage) {
    var iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-forms allow-pointer-lock allow-popups allow-same-origin allow-scripts');
    iframe.setAttribute('frameBorder', '0');
    document.body.appendChild(iframe);
    iframe.src = window.name;
    return;
  }

  /**
   * Live rendering, postMessage style.
   */
  // Set the sandbox target
  sandbox.target = document.getElementById('sandbox-wrapper');
  // Hook into postMessage
  window.onmessage = runner.handleMessage;

};