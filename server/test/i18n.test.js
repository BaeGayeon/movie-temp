import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _dict } from '../../extension/shared/i18n.js';

test('i18n: ko 와 en 의 키가 같다', () => {
  const ko = Object.keys(_dict.ko).sort();
  const en = Object.keys(_dict.en).sort();
  assert.deepEqual(en.filter((k) => !(k in _dict.ko)), [], 'en 에만 있는 키');
  assert.deepEqual(ko.filter((k) => !(k in _dict.en)), [], 'en 번역이 없는 키');
});

test('i18n: ko 와 en 의 {자리표시자}가 같다', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(_dict.ko)) assert.equal(ph(_dict.en[k] ?? ''), ph(_dict.ko[k]), k);
});
