import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { ActivityClock, activityMotion } from "../../src/runtime/activity-animation.js";
import { sweepMotion } from "../../src/surface/sweep.js";
import type { ActivityKind } from "../../src/types.js";
import { animationTime } from "../support/activity-harness.js";

test("every summary multiplier produces the real fractional travel speed on both summary kinds", () => {
	for (const base of [10, 47, 120]) for (const multiplier of [0.25, 0.5, 1, 1.35, 2]) {
		const config = defaultConfig(); config.editor.activityMode = "sweep";
		config.editor.workingSweepSpeed = base; config.editor.summarySpeedMultiplier = multiplier;
		for (const kind of ["compaction", "branchSummary"] as const) {
			const time = animationTime();
			const clock = new ActivityClock({ getMotion: () => activityMotion(config, kind), isPaused: () => false,
				nowMs: time.now, schedule: time.schedule, requestRender() {} });
			clock.frame(); time.advance(1000);
			const frame = clock.frame(); assert.ok(frame?.kind === "sweep");
			assert.equal(frame.speed, base * multiplier);
			assert.ok(Math.abs(sweepMotion(1000, frame.elapsedMs, frame.speed).position - base * multiplier) < 1e-8);
			clock.dispose(); assert.equal(time.pending(), 0);
		}
	}
});

test("speed, summary transitions and pauses preserve distance without replaying blocked time", () => {
	const time = animationTime(), config = defaultConfig(); config.editor.activityMode = "sweep";
	let kind: ActivityKind | undefined = "working", paused = false, renders = 0;
	const clock = new ActivityClock({ getMotion: () => activityMotion(config, kind), isPaused: () => paused,
		nowMs: time.now, schedule: time.schedule, requestRender: () => { renders++; } });
	const distance = () => { const f = clock.frame(); assert.ok(f?.kind === "sweep"); return f.elapsedMs * f.speed / 1000; };
	assert.equal(distance(), 0); time.advance(1000); assert.equal(distance(), 47);
	config.editor.workingSweepSpeed = 94; assert.equal(distance(), 47);
	kind = "compaction"; assert.equal(distance(), 47);
	time.advance(1000); assert.equal(distance(), 94);
	paused = true; assert.equal(clock.frame(), undefined); assert.equal(time.pending(), 0);
	const stale = time.stale(), before = renders;
	time.advance(5000); stale(); assert.equal(renders, before);
	paused = false; assert.equal(distance(), 94);
	time.advance(2000); assert.equal(renders, before + 1, "one delayed render, not missed-frame replay");
	kind = undefined; assert.equal(clock.frame(), undefined); assert.equal(time.pending(), 0);
	clock.dispose(); stale(); assert.equal(time.pending(), 0);
});

test("blink frequency means full cycles and changing the rate retains the phase", () => {
	for (const frequency of [0.25, 0.5, 0.75, 1, 2]) {
		const time = animationTime(), config = defaultConfig(); config.editor.activityMode = "sweep";
		config.editor.retryBlinkHz = frequency;
		const clock = new ActivityClock({ getMotion: () => activityMotion(config, "retry"), isPaused: () => false,
			nowMs: time.now, schedule: time.schedule, requestRender() {} });
		assert.deepEqual(clock.frame(), { kind: "blink", bright: true });
		assert.ok(Math.abs(time.nextDelay() - 500 / frequency) < 1e-8);
		time.advance(500 / frequency); assert.deepEqual(clock.frame(), { kind: "blink", bright: false });
		time.advance(500 / frequency); assert.deepEqual(clock.frame(), { kind: "blink", bright: true });
		time.advance(250 / frequency); config.editor.retryBlinkHz = frequency / 2;
		assert.deepEqual(clock.frame(), { kind: "blink", bright: true });
		assert.ok(Math.abs(time.nextDelay() - 500 / frequency) < 1e-8);
		clock.dispose(); assert.equal(time.pending(), 0);
	}
});

test("Text, idle, lost ownership and disposal leave no timers, including a reentrant close", () => {
	const time = animationTime(), config = defaultConfig();
	let paused = false;
	const clock = new ActivityClock({ getMotion: () => activityMotion(config, "working"), isPaused: () => paused,
		nowMs: time.now, schedule: time.schedule, requestRender: () => clock.dispose() });
	assert.equal(clock.frame(), undefined); assert.equal(time.pending(), 0);
	config.editor.activityMode = "sweep"; clock.frame(); assert.equal(time.pending(), 1);
	paused = true; time.advance(40); assert.equal(time.pending(), 0);
	paused = false; clock.frame(); const stale = time.stale();
	time.advance(40); assert.equal(time.pending(), 0);
	stale(); clock.frame(); clock.dispose(); assert.equal(time.pending(), 0);
});
