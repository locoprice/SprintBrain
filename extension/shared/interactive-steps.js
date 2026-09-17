// interactive-steps.js: the "Interactive Steps" prompt setting, decided once.
//
// When the switch is on, a prompt handed out by SprintBrain starts with a block
// that asks the AI to work one step at a time and wait for the user between
// steps. Every surface that hands out a prompt carries the switch:
//
//   extension/popup/popup.js          Prompts tab, copy
//   extension/content/content.js      the """ picker and """shortcut, insert
//   Sprintbrain.html                  Prompts list, copy
//   app/public/mobile/index.html      Prompts page, copy and share (generated copy)
//   app/src/lib/interactiveSteps.ts   dashboard preview window, copy (TS copy)
//
// The block is added when a prompt leaves SprintBrain and is never saved into
// the prompt, so switching it off gives back exactly the text that was written.
//
// The setting belongs to the device, not the account. The extension keeps it in
// chrome.storage.local, where content.js follows it live. The web surfaces keep
// it under the same key in localStorage. Sprintbrain.html runs this file under
// chrome-shim.js, which folds chrome.storage into a single localStorage entry,
// so the shim is skipped here: the dashboard, mobile and Sprintbrain.html share
// one origin and read one key.
//
// scripts/check-interactive-steps.js pins the behaviour, compares the dashboard
// copy, and writes the mobile copy (--write).
(function(root) {
  'use strict';

  var KEY = 'sb_interactive_steps_enabled';

  var OPEN = '<INTERACTIVE_STEPS>';

  var BLOCK = [
    OPEN,
    'Work through this task with me one step at a time.',
    '1. Start by listing the steps you plan to take, one short line each, and ask me to confirm the plan.',
    '2. Then complete one step per reply. Show the result of that step and stop.',
    '3. End each reply with one short question: continue, change something, or skip ahead.',
    '4. Wait for my answer before you start the next step. Apply any change I ask for first.',
    '5. After the last step, give me the complete final result in one piece.',
    'If this prompt also asks you to ask me clarifying questions, ask them before you list the steps.',
    '</INTERACTIVE_STEPS>'
  ].join('\n');

  // The extension stores a boolean and localStorage stores a string. Only an
  // explicit "on" counts, so nothing stored means off.
  function isOn(value) {
    return value === true || value === 'true';
  }

  // The extension's own storage, or null on a web page. chrome-shim.js answers
  // to chrome.storage too, and is told apart by its runtime id.
  function extensionStorage() {
    var c = root.chrome;
    if (!c || !c.storage || !c.storage.local || !c.runtime) return null;
    return c.runtime.id === 'sprintbrain-web-shim' ? null : c.storage.local;
  }

  // cb(on) once the stored value is known.
  function load(cb) {
    var store = extensionStorage();
    if (store) {
      try {
        store.get(KEY, function(d) {
          cb(!root.chrome.runtime.lastError && isOn(d && d[KEY]));
        });
      } catch (e) {
        // A page left open across an extension reload has lost its context.
        // It keeps the default until it is reloaded, like every other setting.
        cb(false);
      }
      return;
    }
    try {
      cb(isOn(root.localStorage.getItem(KEY)));
    } catch (e) {
      console.error('Interactive Steps: could not read the setting on this device:', e);
      cb(false);
    }
  }

  function save(on) {
    var store = extensionStorage();
    if (store) {
      var patch = {};
      patch[KEY] = on === true;
      store.set(patch, function() {
        if (root.chrome.runtime.lastError) {
          console.error('Interactive Steps: could not save the setting:', root.chrome.runtime.lastError.message);
        }
      });
      return;
    }
    try {
      root.localStorage.setItem(KEY, on === true ? 'true' : 'false');
    } catch (e) {
      console.error('Interactive Steps: could not save the setting on this device:', e);
    }
  }

  // The text a prompt hands out. The block goes first, then a blank line, then
  // the prompt. An empty prompt stays empty, and a prompt that already opens
  // with the block is left alone, so the same text never carries it twice.
  function apply(text, on) {
    var body = text == null ? '' : String(text);
    if (!on || !body.trim()) return body;
    if (body.replace(/^\s+/, '').indexOf(OPEN) === 0) return body;
    return BLOCK + '\n\n' + body;
  }

  var API = {
    KEY: KEY,
    BLOCK: BLOCK,
    isOn: isOn,
    load: load,
    save: save,
    apply: apply
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBInteractiveSteps = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
