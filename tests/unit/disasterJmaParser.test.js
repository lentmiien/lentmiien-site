const {
  parseAtomFeed,
  parseCoordinate,
  parseJmaAlert,
} = require('../../utils/disasterJmaParser');

describe('disasterJmaParser', () => {
  test('parses JMA Atom feed entries', () => {
    const feed = parseAtomFeed(`<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>高頻度（地震火山）</title>
        <updated>2026-06-26T20:01:12+09:00</updated>
        <entry>
          <title>震源・震度に関する情報</title>
          <id>https://www.data.jma.go.jp/developer/xml/data/example.xml</id>
          <updated>2026-06-26T06:43:49Z</updated>
          <author><name>気象庁</name></author>
          <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/example.xml"/>
          <content type="text">【震源・震度情報】地震がありました。</content>
        </entry>
      </feed>`, 'https://example.test/feed.xml');

    expect(feed.title).toBe('高頻度（地震火山）');
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0].url).toBe('https://www.data.jma.go.jp/developer/xml/data/example.xml');
    expect(feed.entries[0].title).toBe('震源・震度に関する情報');
  });

  test('extracts earthquake hypocenter, magnitude, depth, and 横浜旭区 intensity', () => {
    const alert = parseJmaAlert({
      entry: {
        id: 'earthquake-entry',
        url: 'https://example.test/earthquake.xml',
        title: '震源・震度に関する情報',
        updatedAt: new Date('2026-06-26T06:43:49Z'),
      },
      feed: { url: 'https://example.test/feed.xml', title: 'eqvol' },
      xmlText: `<?xml version="1.0" encoding="UTF-8"?>
        <Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
          <Control>
            <Title>震源・震度に関する情報</Title>
            <DateTime>2026-06-26T06:43:49Z</DateTime>
            <Status>通常</Status>
            <PublishingOffice>気象庁</PublishingOffice>
          </Control>
          <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
            <Title>震源・震度情報</Title>
            <ReportDateTime>2026-06-26T15:43:00+09:00</ReportDateTime>
            <TargetDateTime>2026-06-26T15:43:00+09:00</TargetDateTime>
            <EventID>20260626154113</EventID>
            <InfoKind>地震情報</InfoKind>
            <Headline><Text>２６日１５時４１分ころ、地震がありました。</Text></Headline>
          </Head>
          <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/seismology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
            <Earthquake>
              <OriginTime>2026-06-26T15:41:00+09:00</OriginTime>
              <Hypocenter>
                <Area>
                  <Name>東京湾</Name>
                  <Code type="震央地名">342</Code>
                  <jmx_eb:Coordinate description="北緯３５．５度　東経１３９．８度　深さ　５０ｋｍ">+35.5+139.8-50000/</jmx_eb:Coordinate>
                </Area>
              </Hypocenter>
              <jmx_eb:Magnitude type="Mj" description="Ｍ４．３">4.3</jmx_eb:Magnitude>
            </Earthquake>
            <Intensity>
              <Observation>
                <MaxInt>3</MaxInt>
                <Pref><Name>神奈川県</Name><Code>14</Code><MaxInt>2</MaxInt>
                  <Area><Name>神奈川県東部</Name><Code>350</Code><MaxInt>2</MaxInt>
                    <City><Name>横浜旭区</Name><Code>1411200</Code><MaxInt>2</MaxInt>
                      <IntensityStation><Name>横浜旭区川井宿町＊</Name><Code>1411231</Code><Int>2</Int></IntensityStation>
                    </City>
                  </Area>
                </Pref>
              </Observation>
            </Intensity>
          </Body>
        </Report>`,
    });

    expect(alert.category).toBe('earthquake');
    expect(alert.earthquake.hypocenterName).toBe('東京湾');
    expect(alert.earthquake.depthKm).toBe(50);
    expect(alert.earthquake.magnitude).toBe(4.3);
    expect(alert.earthquake.maxIntensity).toBe('3');
    expect(alert.earthquake.yokohamaAsahiIntensity).toBe('2');
  });

  test('extracts weather warning hazards and areas', () => {
    const alert = parseJmaAlert({
      entry: {
        id: 'weather-entry',
        url: 'https://example.test/weather.xml',
        title: '気象特別警報・警報・注意報',
      },
      feed: { url: 'https://example.test/extra.xml', title: 'extra' },
      xmlText: `<?xml version="1.0" encoding="UTF-8"?>
        <Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
          <Control><Title>気象特別警報・警報・注意報</Title><Status>通常</Status></Control>
          <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
            <Title>神奈川県気象警報・注意報</Title>
            <ReportDateTime>2026-06-26T22:13:00+09:00</ReportDateTime>
            <InfoKind>気象警報・注意報</InfoKind>
            <Headline>
              <Text>神奈川県では、低い土地の浸水に警戒してください。</Text>
              <Information type="気象警報・注意報（市町村等）">
                <Item>
                  <Kind><Name>大雨警報</Name><Code>03</Code></Kind>
                  <Kind><Name>雷注意報</Name><Code>14</Code></Kind>
                  <Areas codeType="気象・地震・火山情報／市町村等">
                    <Area><Name>横浜市</Name><Code>1410000</Code></Area>
                  </Areas>
                </Item>
              </Information>
            </Headline>
          </Head>
        </Report>`,
    });

    expect(alert.category).toBe('extreme_weather');
    expect(alert.severity).toBe('warning');
    expect(alert.weather.hazardNames).toEqual(['大雨警報', '雷注意報']);
    expect(alert.weather.areaNames).toEqual(['横浜市']);
  });

  test('extracts typhoon name and storm-wind probability', () => {
    const alert = parseJmaAlert({
      entry: {
        id: 'typhoon-entry',
        url: 'https://example.test/typhoon.xml',
        title: '台風の暴風域に入る確率',
      },
      feed: { url: 'https://example.test/extra.xml', title: 'extra' },
      xmlText: `<?xml version="1.0" encoding="UTF-8"?>
        <Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
          <Control><Title>台風の暴風域に入る確率</Title><Status>通常</Status></Control>
          <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
            <Title>台風の暴風域に入る確率</Title>
            <TargetDuration>PT120H</TargetDuration>
            <EventID>TC2609</EventID>
            <InfoKind>台風の暴風域に入る確率</InfoKind>
          </Head>
          <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
            <MeteorologicalInfos type="台風情報">
              <MeteorologicalInfo type="台風呼称">
                <Item><Kind><Property><Type>呼称</Type><TyphoonNamePart><Name>HIGOS</Name><NameKana>ヒーゴス</NameKana><Number>2608</Number></TyphoonNamePart></Property></Kind></Item>
              </MeteorologicalInfo>
              <MeteorologicalInfo type="台風の暴風域に入る確率（1日積算）">
                <Duration>PT24H</Duration>
                <Item>
                  <Kind><Property><Type>台風の暴風域に入る確率</Type><FiftyKtWindProbabilityPart><FiftyKtWindProbability unit="%">20</FiftyKtWindProbability></FiftyKtWindProbabilityPart></Property></Kind>
                  <Area><Name>横浜・川崎</Name><Code>461011</Code><Prefecture>神奈川県</Prefecture></Area>
                </Item>
              </MeteorologicalInfo>
            </MeteorologicalInfos>
          </Body>
        </Report>`,
    });

    expect(alert.category).toBe('typhoon');
    expect(alert.typhoon.name).toBe('HIGOS');
    expect(alert.typhoon.number).toBe('2608');
    expect(alert.typhoon.maxWindProbability).toBe(20);
    expect(alert.typhoon.maxWindProbabilityArea).toBe('横浜・川崎');
  });

  test('parses JMA typhoon coordinate arrays', () => {
    const coordinate = parseCoordinate([
      {
        '#text': '+35.6+141.1/',
        '@_description': '北緯３５．６度東経１４１．１度',
        '@_type': '中心位置（度）',
      },
      {
        '#text': '+3535+14105/',
        '@_description': '北緯３５度３５分東経１４１度０５分',
        '@_type': '中心位置（度分）',
      },
    ]);

    expect(coordinate.latitude).toBeCloseTo(35.6, 3);
    expect(coordinate.longitude).toBeCloseTo(141.1, 3);
  });

  test('extracts typhoon track center points', () => {
    const alert = parseJmaAlert({
      entry: {
        id: 'typhoon-track-entry',
        url: 'https://example.test/typhoon-track.xml',
        title: '台風解析・予報情報（５日予報）（Ｈ３０）',
      },
      feed: { url: 'https://example.test/extra.xml', title: 'extra' },
      xmlText: `<?xml version="1.0" encoding="UTF-8"?>
        <Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
          <Control><Title>台風解析・予報情報（５日予報）（Ｈ３０）</Title><Status>通常</Status></Control>
          <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
            <Title>台風解析・予報情報</Title>
            <ReportDateTime>2026-06-27T07:45:00+09:00</ReportDateTime>
            <TargetDateTime>2026-06-27T07:00:00+09:00</TargetDateTime>
            <TargetDuration>PT120H</TargetDuration>
            <EventID>TC2609</EventID>
            <InfoKind>台風解析・予報情報（５日予報）</InfoKind>
            <Headline><Text/></Headline>
          </Head>
          <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
            <MeteorologicalInfos type="台風情報">
              <MeteorologicalInfo>
                <DateTime type="実況">2026-06-27T07:00:00+09:00</DateTime>
                <Item>
                  <Kind><Property><Type>呼称</Type><TyphoonNamePart><Name>HIGOS</Name><NameKana>ヒーゴス</NameKana><Number>2608</Number></TyphoonNamePart></Property></Kind>
                  <Kind><Property><Type>中心</Type><CenterPart>
                    <jmx_eb:Coordinate description="北緯３５．６度東経１４１．１度" type="中心位置（度）">+35.6+141.1/</jmx_eb:Coordinate>
                    <jmx_eb:Coordinate description="北緯３５度３５分東経１４１度０５分" type="中心位置（度分）">+3535+14105/</jmx_eb:Coordinate>
                    <Location>銚子市の東南東約30km</Location>
                    <jmx_eb:Direction unit="１６方位漢字" type="移動方向">北東</jmx_eb:Direction>
                    <jmx_eb:Speed description="毎時１００キロ" unit="km/h" type="移動速度">100</jmx_eb:Speed>
                    <jmx_eb:Pressure description="中心気圧９９８ヘクトパスカル" unit="hPa" type="中心気圧">998</jmx_eb:Pressure>
                  </CenterPart></Property></Kind>
                </Item>
              </MeteorologicalInfo>
            </MeteorologicalInfos>
          </Body>
        </Report>`,
    });

    expect(alert.category).toBe('typhoon');
    expect(alert.typhoon.track).toHaveLength(1);
    expect(alert.typhoon.track[0].latitude).toBeCloseTo(35.6, 3);
    expect(alert.typhoon.track[0].longitude).toBeCloseTo(141.1, 3);
    expect(alert.typhoon.track[0].location).toBe('銚子市の東南東約30km');
    expect(alert.typhoon.track[0].pressureHpa).toBe(998);
    expect(alert.typhoon.track[0].speedKmh).toBe(100);
  });
});
