// The dataset relay's target policy — the one part of `/api/plug` that decides
// whether a URL may be fetched on the reader's behalf. Pure, so it is pinned
// here without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plugRelayTargetFault } from '../../vite.config.js';

test('accepts the French open-data hosts over https, and nothing else', () => {
  assert.equal(plugRelayTargetFault('https://www.data.gouv.fr/api/1/datasets/r/abc'), null);
  assert.equal(plugRelayTargetFault('https://static.data.gouv.fr/resources/x/file.csv'), null);
  assert.equal(plugRelayTargetFault('https://tabular-api.data.gouv.fr/api/resources/x/data/'), null);
  assert.equal(plugRelayTargetFault('https://data.geopf.fr/wfs/ows?service=WFS'), null);
  assert.equal(plugRelayTargetFault('https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/x'), null);
  assert.equal(plugRelayTargetFault('https://www.insee.fr/fr/statistiques/fichier/x.zip'), null);
  assert.equal(plugRelayTargetFault('https://raw.githubusercontent.com/o/r/main/a.geojson'), null);
  assert.match(plugRelayTargetFault('http://www.data.gouv.fr/x'), /https/);
  assert.match(plugRelayTargetFault('https://evil.example/data.gouv.fr'), /hôte non autorisé/);
  assert.match(plugRelayTargetFault('https://notdata.gouv.fr/x'), /hôte non autorisé/, 'a suffix match needs the dot');
  assert.match(plugRelayTargetFault('https://user:pw@www.data.gouv.fr/x'), /identifiants/);
  assert.match(plugRelayTargetFault('https://127.0.0.1/x'), /hôte non autorisé/);
  assert.match(plugRelayTargetFault('not a url'), /invalide/);
  assert.equal(plugRelayTargetFault('https://data.example.org/a.geojson', ['example.org']), null, 'GEV_PLUG_HOSTS extends the list');
});
