import { describe, expect, test } from 'bun:test';
import updateSidecar from './updateSidecar';

// Entirely in-memory: no runtime bootstrap, shared DB, or real Knowledge writes.
describe('knowledge.updateSidecar runner', () => {
    test('runner uses writer-visible sources, tolerates excluded cutoff and preserves applied checkpoint on failure', async () => {
        const parent: any = { id: 'p', scratchpad: { knowledgeSidecar: { status: 'error', appliedSourceMessageIdx: 1, lastSuccessfulMessageIdx: 0, sourceMessageIdx: 9 } } };
        const child: any = { id: 'c' }; let requested: any; let archived = false;
        const ctx: any = { fns: {
            procs: { db: { select: async () => [] } }, knowledge: { extractionSchema: async () => ({ types: [], attributes: [], vocabularies: {} }) },
            session: { getMessages: async (o: any) => { requested = o; return [{ idx: 1, role: 'user', content: 'old' }, { idx: 2, role: 'tool', content: 'tool evidence' }, { idx: 4, role: 'user', content: 'future' }]; },
                fork: async () => child, save: async () => {}, mutateScratchpad: async ({ mutate }: any) => ({ result: mutate(parent.scratchpad, 123), scratchpad: parent.scratchpad }), archive: async () => { archived = true; } },
            settings: { getNumber: async () => 1000 }, agent: { run: async () => { throw new Error('extraction failed'); } }, events: { refreshAgentMeta: () => {} },
        } };
        parent.scratchpad.knowledgeSidecar.sourceMessageIdx = 1;
        const result = await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 });
        expect(requested).toEqual({ id: 'p' });
        expect(child.scratchpad.sourceMessages.map((r: any) => r.idx)).toEqual([2]);
        expect(result.status).toBe('error'); expect(parent.scratchpad.knowledgeSidecar.appliedSourceMessageIdx).toBe(1); expect(archived).toBe(true);
        expect(parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx).toBe(1);
        // Writer contract: only appliedSourceMessageIdx advances on a successful write.
        ctx.fns.agent.run = async () => { parent.scratchpad.knowledgeSidecar = { ...parent.scratchpad.knowledgeSidecar, status: 'ready', sidecarId: 'c', appliedSourceMessageIdx: 3, sourceMessageIdx: 3 }; };
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('ready');
        expect(parent.scratchpad.knowledgeSidecar.lastSuccessfulMessageIdx).toBe(1);
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('duplicate');
        expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 2 })).status).toBe('stale');
        // A concurrent successful writer must win both normal and error completion.
        for (const throws of [false, true]) {
            parent.scratchpad.knowledgeSidecar = { status: 'error', appliedSourceMessageIdx: 1, lastSuccessfulMessageIdx: 0 };
            ctx.fns.agent.run = async () => { parent.scratchpad.knowledgeSidecar = { status: 'error', appliedSourceMessageIdx: 5, lastSuccessfulMessageIdx: 0 }; if (throws) throw new Error('late failure'); };
            expect((await updateSidecar(ctx, null, { agent: parent, messageIdx: 3 })).status).toBe('stale');
            expect(parent.scratchpad.knowledgeSidecar.appliedSourceMessageIdx).toBe(5);
        }
    });
});
