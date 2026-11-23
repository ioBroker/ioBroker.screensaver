import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { IMMICH_LINK_KEY, immichLink, withImmichLink } from './immichLink';

const DOCKER_OFF = { enabled: false, bind: '0.0.0.0', port: 2283 };

describe('the card of Immich in the quick access of admin', () => {
    it('points to Immich in Docker on the host of the instance', () => {
        assert.equal(immichLink({ enabled: true, bind: '0.0.0.0', port: 2283 }, ''), 'http://%ip%:2283');
        assert.equal(immichLink({ enabled: true, bind: '192.168.1.5', port: 2300 }, ''), 'http://192.168.1.5:2300');
        assert.equal(immichLink({ enabled: true, bind: 'fd00::5', port: 2283 }, ''), 'http://[fd00::5]:2283');
        // only reachable on the host itself: no card
        assert.equal(immichLink({ enabled: true, bind: '127.0.0.1', port: 2283 }, ''), null);
    });

    it('points to an Immich of its own, with the host of the instance for localhost', () => {
        assert.equal(immichLink(DOCKER_OFF, ' http://192.168.1.10:2283/api/ '), 'http://192.168.1.10:2283');
        assert.equal(immichLink(DOCKER_OFF, 'https://photos.example.com'), 'https://photos.example.com');
        assert.equal(immichLink(DOCKER_OFF, 'http://localhost:2283'), 'http://%ip%:2283');
        assert.equal(immichLink(DOCKER_OFF, 'http://127.0.0.1:2283'), 'http://%ip%:2283');
        assert.equal(immichLink(DOCKER_OFF, 'http://localhost.example.com'), 'http://localhost.example.com');
    });

    it('is not there without Immich', () => {
        assert.equal(immichLink(DOCKER_OFF, ''), null);
        assert.equal(immichLink(DOCKER_OFF, undefined), null);
        assert.equal(immichLink(DOCKER_OFF, 'photos'), null);
    });

    it('is added and removed without touching other links', () => {
        const added = withImmichLink(undefined, 'http://%ip%:2283');
        assert.deepEqual(Object.keys(added || {}), [IMMICH_LINK_KEY]);
        const card = added?.[IMMICH_LINK_KEY] as ioBroker.LocalLink;
        assert.equal(card.link, 'http://%ip%:2283');
        assert.equal(card.name, 'Immich');
        assert.equal(card.intro, true);
        // the same settings give the same links: the instance object is not written again
        assert.deepEqual(withImmichLink(added, 'http://%ip%:2283'), added);

        assert.equal(withImmichLink(added, null), undefined);
        const other = { _default: 'http://%ip%:8082' };
        assert.deepEqual(withImmichLink({ ...other, ...added }, null), other);
        assert.deepEqual(withImmichLink(other, null), other);
    });
});
