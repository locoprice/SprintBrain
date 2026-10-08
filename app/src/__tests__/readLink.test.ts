import { describe, expect, it } from 'vitest';
import { isPrivateAddress, linkProblem } from '../../../services/supabase/functions/read-link/linkGuard';
import { declaredCharset, decodeEntities, pageText } from '../../../services/supabase/functions/read-link/pageText';

// Fill from link — the server half.
//
// read-link opens a page somebody pasted, from SprintBrain's servers, and hands
// back its visible text. These tests pin the two things that must never go
// wrong there: which links it may open at all, and that what comes back is the
// page's text, in the page's order, with nothing hidden mixed in.

describe('linkProblem: only public https pages', () => {
  it.each([
    'https://example.com/order/7',
    'https://shop.example.co.uk/receipt?id=7&key=abc',
    'https://example.com:443/a',
    'https://xn--bcher-kva.example/',
  ])('accepts %s', (link) => {
    expect(linkProblem(link)).toBe('');
  });

  it.each([
    ['http://example.com/a', 'link_not_allowed'],
    ['ftp://example.com/a', 'link_not_allowed'],
    ['https://example.com:8443/a', 'link_not_allowed'],
    ['https://user:secret@example.com/a', 'link_not_allowed'],
    ['https://localhost/a', 'link_not_allowed'],
    ['https://localhost./a', 'link_not_allowed'],
    ['https://printer.local/a', 'link_not_allowed'],
    ['https://db.internal/a', 'link_not_allowed'],
    ['https://intranet/a', 'link_not_allowed'],
    ['https://127.0.0.1/a', 'link_not_allowed'],
    ['https://169.254.169.254/latest/meta-data', 'link_not_allowed'],
    ['https://2130706433/a', 'link_not_allowed'],
    ['https://0x7f.1/a', 'link_not_allowed'],
    ['https://93.184.216.34/a', 'link_not_allowed'],
    ['https://[::1]/a', 'link_not_allowed'],
    ['not a link', 'invalid_link'],
    ['', 'invalid_link'],
    ['https://example.com/' + 'a'.repeat(2100), 'invalid_link'],
  ])('refuses %s', (link, code) => {
    expect(linkProblem(link)).toBe(code);
  });
});

describe('isPrivateAddress: names that look up to somewhere private', () => {
  it.each([
    '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '127.0.0.1', '0.0.0.0',
    '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::a00:1',
    'garbage',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1::1', '::ffff:93.184.216.34'])(
    '%s is public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('pageText: the visible text, in order', () => {
  const PAGE = `<!doctype html><html><head><title>Order 7</title>
    <style>.lbl{color:red}</style><script>var secret = "Customer";</script></head>
    <body>
      <!-- Customer: hidden comment -->
      <div class="row"><span class="lbl">Customer</span><span class="val">Ada&nbsp;Lovelace</span></div>
      <div class="row"><span class="lbl">Pick-up</span>
        <span class="val">Friday, 09-10-2026   14:00</span></div>
      <p>Return: Sunday, 11-10-2026</p>
      <ul><li>2 Boxes</li><li><b>1</b> Box</li></ul>
      <select><option>Gold</option></select><button>Add</button>
      <textarea>typed text</textarea>
      <p>Caf&eacute; &amp; more &#8364;5 &#x2014; done</p>
    </body></html>`;

  it('keeps label and value as separate pieces, in page order', () => {
    expect(pageText(PAGE)).toEqual([
      'Customer', 'Ada Lovelace',
      'Pick-up', 'Friday, 09-10-2026 14:00',
      'Return: Sunday, 11-10-2026',
      '2 Boxes', '1', 'Box',
      'Café & more €5 — done',
    ]);
  });

  it('never returns code, styles, comments, the title or form controls', () => {
    const text = pageText(PAGE).join(' ');
    for (const hidden of ['secret', 'color:red', 'hidden comment', 'Order 7', 'Gold', 'Add', 'typed text']) {
      expect(text).not.toContain(hidden);
    }
  });

  it('caps a huge page instead of reading all of it', () => {
    const huge = '<p>x</p>'.repeat(20000);
    expect(pageText(huge).length).toBe(8000);
  });

  it('decodes entities and leaves unknown ones as written', () => {
    expect(decodeEntities('&lt;b&gt; &quot;a&quot; &unknown; &#0; &#xD800;')).toBe('<b> "a" &unknown;  ');
  });

  it('reads the declared character set from the header, then the page', () => {
    expect(declaredCharset('text/html; charset=ISO-8859-1', '')).toBe('iso-8859-1');
    expect(declaredCharset('text/html', '<meta charset="windows-1252">')).toBe('windows-1252');
    expect(declaredCharset('text/html', '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>'))
      .toBe('utf-8');
    expect(declaredCharset('text/html', '<p>nothing</p>')).toBe('');
  });
});
