import test from 'node:test';
import assert from 'node:assert/strict';
import { isApexHost, rootDomain, normalizeUrl, priceVisible, stripTracking } from '../lib/util.js';

test('domínio raiz considera TLDs de segundo nível (.com.br)', () => {
  assert.equal(rootDomain('loja.elements.com.br'), 'elements.com.br');
  assert.equal(rootDomain('www.exemplo.com'), 'exemplo.com');
  assert.equal(isApexHost('elements.com.br'), true);
  assert.equal(isApexHost('www.elements.com.br'), true);
  assert.equal(isApexHost('loja.elements.com.br'), false);
});

test('normalizeUrl ignora hash e barra final', () => {
  assert.equal(normalizeUrl('https://a.com/x/#top'), 'https://a.com/x');
  assert.equal(normalizeUrl('https://a.com'), 'https://a.com/');
  assert.equal(normalizeUrl('https://a.com/x?y=1'), 'https://a.com/x?y=1');
});

test('stripTracking remove utm e gclid', () => {
  assert.equal(stripTracking('https://a.com/x?utm_source=g&id=2&gclid=1'), 'https://a.com/x?id=2');
});

test('priceVisible reconhece formatos BR e US sem falso positivo por substring', () => {
  assert.equal(priceVisible('Por apenas R$ 1.167,37 à vista', 1167.37), true);
  assert.equal(priceVisible('price 1167.37', 1167.37), true);
  assert.equal(priceVisible('USD 1,167.37', 1167.37), true);
  assert.equal(priceVisible('R$ 11.167,37', 1167.37), false);
  assert.equal(priceVisible('Cadastre-se e veja os preços', 1167.37), false);
  assert.equal(priceVisible('R$ 990,00', 990), true);
  assert.equal(priceVisible('R$ 9.900,00', 990), false);
});
