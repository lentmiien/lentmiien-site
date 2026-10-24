// RECONSTRUCTED from the structural facts supplied in the production diagnosis.
// These are NOT downloaded originals. Counts, first Akita/Chiba grouped codes,
// local codes, report times, products, empty EventID and local hazard statuses
// match that diagnosis. Other codes/names and control times are reconstructed,
// not a geographic registry or a claim about the original XML bytes.
const cases = [
  { id: '20261024231140_0_VPWW54_050000.xml', at: '2026-10-24T23:11:00Z', groups: 6, municipalities: 25, firstGroup: '050011' },
  { id: '20261024231140_0_VPWW53_050000.xml', at: '2026-10-24T23:11:00Z', groups: 6, municipalities: 25, firstGroup: '050011' },
  { id: '20261024230923_0_VPWW53_120000.xml', at: '2026-10-24T23:09:00Z', groups: 7, municipalities: 54, firstGroup: '120011' },
  { id: '20261024230725_0_VPWW53_140000.xml', at: '2026-10-24T23:07:00Z', groups: 7, municipalities: 35, firstGroup: '140011', local: true },
];
const clear = '<Kind><Name>発表警報・注意報はなし</Name><Code>00</Code></Kind>';
const localKinds = '<Kind><Name>雷注意報</Name><Code>14</Code><Status>継続</Status></Kind>' +
  '<Kind><Name>強風注意報</Name><Code>15</Code><Status>発表</Status></Kind>' +
  '<Kind><Name>濃霧注意報</Name><Code>20</Code><Status>解除</Status></Kind>';
function xml(fixture) {
  const groups = Array.from({ length: fixture.groups }, (_, i) => `<Item><Area><Name>Reconstructed grouped region ${i}</Name><Code>${String(Number(fixture.firstGroup) + i).padStart(6, '0')}</Code></Area>${clear}</Item>`).join('');
  const municipalities = Array.from({ length: fixture.municipalities }, (_, i) => {
    const local = fixture.local && i === 0;
    const code = local ? '1410011' : `${fixture.firstGroup.slice(0, 2)}${String(20000 + i).padStart(5, '0')}`;
    return `<Item><Area><Name>${local ? '横浜市北部' : `Reconstructed municipality ${i}`}</Name><Code>${code}</Code></Area>${local ? localKinds : clear}</Item>`;
  }).join('');
  return `<jmx:Report xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/"><jmx:Control><Title>気象警報・注意報</Title><DateTime>${fixture.at}</DateTime><Status>通常</Status></jmx:Control><Head><Title>Reconstructed bulletin</Title><ReportDateTime>${fixture.at}</ReportDateTime><InfoType>発表</InfoType><EventID/><Serial/></Head><Body><Warning type="気象警報・注意報（市町村等をまとめた地域等）">${groups}</Warning><Warning type="気象警報・注意報（市町村等）">${municipalities}</Warning></Body></jmx:Report>`;
}
module.exports = { cases, xml };
