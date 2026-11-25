// Retro Macintosh Web Audio synthesizer for MazeWars+.

class RetroAudio {
    constructor() {
        this.ctx = null;
        this.muted = false;
    }

    ensureContext() {
        if (this.muted) return null;
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {});
        }
        return this.ctx;
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
    }

    playLaser() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1180, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
    }

    playStep() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(75, now + 0.035);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
    }

    playBump() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(95, now);
        osc.frequency.linearRampToValueAtTime(52, now + 0.09);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
    }

    playHit() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const bufferSize = Math.floor(ctx.sampleRate * 0.22);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(640, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
    }

    playKill() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "square";
            const t = now + idx * 0.05;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.07, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.07);
        });
    }

    playTeleport() {
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.18);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
    }
}

export const audio = new RetroAudio();
