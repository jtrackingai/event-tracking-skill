import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { parseLiveGtmRuntime } = require(path.join(repoRoot, 'dist', 'gtm', 'live-parser.js'));

function makeRuntimeScript() {
  return `
    (function(){
      var data = {
        "resource": {
          "version": "1",
          "macros": [
            {"function":"__e"},
            {"function":"__c","vtp_value":"G-TEST123"},
            {"function":"__v","vtp_name":"gtm.element","vtp_dataLayerVersion":1},
            {"function":"__u","vtp_component":"URL"},
            {"function":"__c","vtp_value":"signup_button"}
          ],
          "tags": [
            {"function":"__googtag","vtp_tagId":["macro",1],"tag_id":1},
            {"function":"__gaawe","vtp_eventName":"signup_click","vtp_measurementIdOverride":["macro",1],"vtp_eventSettingsTable":["list",["map","parameter","button_name","parameterValue",["macro",4]]],"tag_id":2},
            {"function":"__gaawe","vtp_eventName":"pricing_click","vtp_measurementIdOverride":"G-TEST123","vtp_eventSettingsTable":["list",["map","parameter","page_location","parameterValue","{{Page URL}}"]],"tag_id":3}
          ],
          "predicates": [
            {"function":"_eq","arg0":["macro",0],"arg1":"gtm.click"},
            {"function":"_css","arg0":["macro",2],"arg1":"button.signup"},
            {"function":"_re","arg0":["macro",3],"arg1":"^https://example.com/pricing(?:/)?$"}
          ],
          "rules": [
            [["if",0,1],["add",1]],
            [["if",0,2],["add",2]]
          ]
        }
      };
    })();
  `;
}

test('parseLiveGtmRuntime extracts GA4 events, parameters, and trigger hints from a public GTM runtime', () => {
  const parsed = parseLiveGtmRuntime(makeRuntimeScript(), 'GTM-TEST1234');

  assert.equal(parsed.publicId, 'GTM-TEST1234');
  assert.deepEqual(parsed.measurementIds, ['G-TEST123']);
  assert.deepEqual(parsed.configTagIds, ['G-TEST123']);
  assert.equal(parsed.events.length, 2);

  const signup = parsed.events.find(event => event.eventName === 'signup_click');
  assert.ok(signup, 'signup_click should be parsed');
  assert.deepEqual(signup.measurementIds, ['G-TEST123']);
  assert.equal(signup.parameters[0]?.name, 'button_name');
  assert.ok(signup.triggerHint.triggerTypes.includes('click'));
  assert.ok(signup.triggerHint.selectors.includes('button.signup'));

  const pricing = parsed.events.find(event => event.eventName === 'pricing_click');
  assert.ok(pricing, 'pricing_click should be parsed');
  assert.ok(pricing.triggerHint.triggerTypes.includes('click'));
  assert.ok(pricing.triggerHint.urlPatterns.includes('^https://example.com/pricing(?:/)?$'));
});
