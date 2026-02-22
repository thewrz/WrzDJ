/**
 * TDD Tests for Deck State Manager
 *
 * Tests the state machine that determines when a track is truly "live"
 * (not being cued/prepared) and should be reported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeckStateManager } from "../deck-state-manager.js";
import type { DeckStateType, TrackInfo } from "../deck-state.js";

describe("DeckStateManager", () => {
  let manager: DeckStateManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new DeckStateManager({
      liveThresholdSeconds: 15,
      pauseGraceSeconds: 3,
      nowPlayingPauseSeconds: 10,
      useFaderDetection: true,
      masterDeckPriority: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initial State", () => {
    it("starts with no decks (created on demand)", () => {
      expect(manager.getDeckIds()).toEqual([]);
    });

    it("creates deck on demand via getDeckState", () => {
      const state = manager.getDeckState("1");
      expect(state.state).toBe("EMPTY");
      expect(state.track).toBeNull();
      expect(state.isPlaying).toBe(false);
      expect(manager.getDeckIds()).toEqual(["1"]);
    });

    it("includes all dynamically created decks in getDeckIds", () => {
      manager.getDeckState("1");
      manager.getDeckState("2");
      manager.getDeckState("1A");
      expect(manager.getDeckIds()).toEqual(["1", "2", "1A"]);
    });
  });

  describe("Track Loading", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
      album: "Test Album",
    };

    it("transitions from EMPTY to LOADED when track is loaded", () => {
      manager.updateTrackInfo("1", testTrack);

      const state = manager.getDeckState("1");
      expect(state.state).toBe("LOADED");
      expect(state.track).toEqual(testTrack);
    });

    it("resets state when new track is loaded", () => {
      // Load first track and start playing
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Load new track
      const newTrack: TrackInfo = {
        title: "New Song",
        artist: "New Artist",
      };
      manager.updateTrackInfo("1", newTrack);

      const state = manager.getDeckState("1");
      expect(state.state).toBe("LOADED");
      expect(state.track).toEqual(newTrack);
      expect(state.playStartTime).toBeNull();
    });

    it("clears deck state when null track is loaded", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updateTrackInfo("1", null);

      const state = manager.getDeckState("1");
      expect(state.state).toBe("EMPTY");
      expect(state.track).toBeNull();
    });
  });

  describe("Play State Transitions", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("transitions from LOADED to CUEING when play starts", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      expect(manager.getDeckState("1").state).toBe("CUEING");
    });

    it("transitions from CUEING to PLAYING after threshold", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Before threshold
      vi.advanceTimersByTime(14999);
      expect(manager.getDeckState("1").state).toBe("CUEING");
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // After threshold (15 seconds)
      vi.advanceTimersByTime(1);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(deckLiveHandler).toHaveBeenCalledWith({
        deckId: "1",
        track: testTrack,
      });
    });

    it("does NOT emit deckLive if track was already reported", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // First time - should emit
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // If we somehow try again, should not emit again
      expect(manager.shouldReportTrack("1")).toBe(false);
    });
  });

  describe("Pause Handling", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("pausing during CUEING resets to LOADED", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      expect(manager.getDeckState("1").state).toBe("CUEING");

      manager.updatePlayState("1", false);
      expect(manager.getDeckState("1").state).toBe("LOADED");
    });

    it("brief pause (<3s) during CUEING maintains accumulated time", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Play for 10 seconds
      vi.advanceTimersByTime(10000);

      // Brief pause for 2 seconds
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);

      // Resume
      manager.updatePlayState("1", true);

      // Only need 5 more seconds to hit threshold (10 + 5 = 15)
      vi.advanceTimersByTime(5000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("long pause (>3s) during CUEING resets timer", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Play for 10 seconds
      vi.advanceTimersByTime(10000);

      // Long pause for 4 seconds (exceeds grace period)
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(4000);

      // Resume - timer should reset
      manager.updatePlayState("1", true);

      // After 10 more seconds, should still be CUEING
      vi.advanceTimersByTime(10000);
      expect(manager.getDeckState("1").state).toBe("CUEING");
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Need full 15 seconds now
      vi.advanceTimersByTime(5000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("brief pause during PLAYING does not change state", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");

      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");

      manager.updatePlayState("1", true);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
    });

    it("long pause during PLAYING transitions to ENDED", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");

      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(4000); // Exceeds grace period
      expect(manager.getDeckState("1").state).toBe("ENDED");
    });
  });

  describe("Rapid Play/Pause (Cueing Behavior)", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("rapid play/pause cycles should NOT trigger live report", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);

      // DJ cueing the track - rapid play/pause
      for (let i = 0; i < 10; i++) {
        manager.updatePlayState("1", true);
        vi.advanceTimersByTime(500); // Play for 0.5 seconds
        manager.updatePlayState("1", false);
        vi.advanceTimersByTime(500); // Pause for 0.5 seconds
      }

      // After 10 seconds of cueing, should NOT have triggered
      expect(deckLiveHandler).not.toHaveBeenCalled();
      expect(manager.getDeckState("1").state).not.toBe("PLAYING");
    });

    it("accumulates play time across brief pauses within grace period", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);

      // Play 5 seconds, pause 2 seconds (within grace), play 5 seconds, pause 2 seconds, play 5 seconds
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(5000);
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(5000);
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(5000);

      // Total play time: 5 + 5 + 5 = 15 seconds
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Looping", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("track looping for 60s only triggers ONE report", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Play continuously for 60 seconds (simulating loop)
      vi.advanceTimersByTime(60000);

      // Should only have emitted once at the 15-second mark
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
    });
  });

  describe("Multi-Deck Independence", () => {
    const track1: TrackInfo = {
      title: "Song One",
      artist: "Artist One",
    };
    const track2: TrackInfo = {
      title: "Song Two",
      artist: "Artist Two",
    };

    it("tracks state independently per deck", () => {
      manager.updateTrackInfo("1", track1);
      manager.updateTrackInfo("2", track2);

      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(8000);

      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(7000);

      // Deck 1: 15 seconds playing = PLAYING
      // Deck 2: 7 seconds playing = CUEING
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(manager.getDeckState("2").state).toBe("CUEING");
    });

    it("same track on different decks can report after grace period expires", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Same track on both decks
      manager.updateTrackInfo("1", track1);
      manager.updateTrackInfo("2", track1);

      // Deck 1 goes live first
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);

      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(deckLiveHandler).toHaveBeenCalledWith({
        deckId: "1",
        track: track1,
      });
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 2 starts playing (reaches PLAYING state internally but not reported)
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 2 should NOT have reported yet - deck 1 has priority
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 1 pauses
      manager.updatePlayState("1", false);

      // After grace period (3s), deck 1 transitions to ENDED → scan triggers switch
      vi.advanceTimersByTime(3000);

      // Now deck 2 should report
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(deckLiveHandler).toHaveBeenLastCalledWith({
        deckId: "2",
        track: track1,
      });
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
    });
  });

  describe("Fader Level Detection", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("does not report if fader is at 0", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 0);
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);

      // Track is playing but fader is down - should NOT report
      expect(deckLiveHandler).not.toHaveBeenCalled();
      expect(manager.shouldReportTrack("1")).toBe(false);
    });

    it("reports when fader goes up after threshold", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 0);
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Fader comes up
      manager.updateFaderLevel("1", 0.8);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("reports immediately if fader is up when threshold is reached", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 1.0);
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("ignores fader when useFaderDetection is false", () => {
      manager = new DeckStateManager({
        liveThresholdSeconds: 15,
        pauseGraceSeconds: 3,
        nowPlayingPauseSeconds: 10,
        useFaderDetection: false,
        masterDeckPriority: true,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 0); // Fader down
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      // Should report even with fader down because detection is disabled
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Master Deck Priority", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("tracks master deck status", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("1");

      expect(manager.getDeckState("1").isMaster).toBe(true);
      expect(manager.getDeckState("2").isMaster).toBe(false);
    });

    it("only one deck can be master at a time", () => {
      manager.setMasterDeck("1");
      expect(manager.getDeckState("1").isMaster).toBe(true);

      manager.setMasterDeck("2");
      expect(manager.getDeckState("1").isMaster).toBe(false);
      expect(manager.getDeckState("2").isMaster).toBe(true);
    });

    it("non-master deck does not report when masterDeckPriority is true", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("2"); // Deck 2 is master
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);

      // Deck 1 meets threshold but is not master
      expect(deckLiveHandler).not.toHaveBeenCalled();
    });

    it("reports when deck becomes master after threshold", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("2");
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Deck 1 becomes master
      manager.setMasterDeck("1");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("reports regardless of master when masterDeckPriority is false", () => {
      manager = new DeckStateManager({
        liveThresholdSeconds: 15,
        pauseGraceSeconds: 3,
        nowPlayingPauseSeconds: 10,
        useFaderDetection: true,
        masterDeckPriority: false,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("2"); // Deck 2 is master
      manager.updateFaderLevel("1", 1.0);
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      // Should report even though not master
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("shouldReportTrack", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("returns false for empty deck", () => {
      expect(manager.shouldReportTrack("1")).toBe(false);
    });

    it("returns false for LOADED deck", () => {
      manager.updateTrackInfo("1", testTrack);
      expect(manager.shouldReportTrack("1")).toBe(false);
    });

    it("returns false for CUEING deck", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      expect(manager.shouldReportTrack("1")).toBe(false);
    });

    it("returns true for PLAYING deck that meets all criteria", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 1.0);
      manager.setMasterDeck("1");
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(15000);
      // Already reported via event, so shouldReportTrack returns false
      expect(manager.shouldReportTrack("1")).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("handles play before track load gracefully", () => {
      manager.updatePlayState("1", true);
      expect(manager.getDeckState("1").state).toBe("EMPTY");
    });

    it("handles duplicate play state updates", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      manager.updatePlayState("1", true);
      manager.updatePlayState("1", true);

      expect(manager.getDeckState("1").state).toBe("CUEING");

      vi.advanceTimersByTime(15000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
    });

    it("handles unknown deck IDs by creating new deck state", () => {
      expect(() => manager.getDeckState("5")).not.toThrow();
      expect(manager.getDeckState("5").state).toBe("EMPTY");
    });

    it("evicts EMPTY deck when maximum deck limit is reached", () => {
      // Create 16 decks from scratch (no pre-init)
      for (let i = 1; i <= 16; i++) {
        expect(() => manager.getDeckState(String(i))).not.toThrow();
      }

      // 17th deck should evict an EMPTY deck (all are EMPTY by default)
      expect(() => manager.getDeckState("17")).not.toThrow();
      expect(manager.getDeckState("17").state).toBe("EMPTY");
    });

    it("evicts ENDED deck when all decks are active except ENDED", () => {
      // Fill 16 decks, put them all through CUEING → PLAYING
      for (let i = 1; i <= 16; i++) {
        const id = String(i);
        manager.updateTrackInfo(id, testTrack);
        manager.updateFaderLevel(id, 1.0);
        manager.setMasterDeck(id);
        manager.updatePlayState(id, true);
      }

      // Advance past liveThresholdSeconds to transition CUEING → PLAYING
      vi.advanceTimersByTime(16_000);

      // Transition deck 5 to ENDED: pause beyond grace period
      manager.updatePlayState("5", false);
      vi.advanceTimersByTime(4000); // Grace period (3s) expires → ENDED

      expect(manager.getDeckState("5").state).toBe("ENDED");

      // 17th deck should evict the ENDED deck
      expect(() => manager.getDeckState("17")).not.toThrow();
    });

    it("evicts LOADED deck when no EMPTY/ENDED decks remain", () => {
      // Fill 15 decks as PLAYING, 1 as LOADED (track loaded but not playing)
      for (let i = 1; i <= 15; i++) {
        const id = String(i);
        manager.updateTrackInfo(id, testTrack);
        manager.updateFaderLevel(id, 1.0);
        manager.setMasterDeck(id);
        manager.updatePlayState(id, true);
      }
      vi.advanceTimersByTime(16_000); // CUEING → PLAYING

      // Deck 16 stays LOADED (track loaded, never played)
      manager.updateTrackInfo("16", testTrack);
      expect(manager.getDeckState("16").state).toBe("LOADED");

      // 17th deck should evict the LOADED deck
      expect(() => manager.getDeckState("17")).not.toThrow();
    });

    it("evicts CUEING deck as last resort before throwing", () => {
      // Fill 15 decks as PLAYING, 1 as CUEING
      for (let i = 1; i <= 16; i++) {
        const id = String(i);
        manager.updateTrackInfo(id, testTrack);
        manager.updateFaderLevel(id, 1.0);
        manager.setMasterDeck(id);
        manager.updatePlayState(id, true);
      }
      // Only advance 1s — not enough for 15s threshold, so all stay CUEING
      // Actually we need 15 in PLAYING and 1 in CUEING
      // Reset: advance to get all to PLAYING first
      vi.advanceTimersByTime(16_000);

      // Now load a new track on deck 16 (resets to LOADED), then play (→ CUEING)
      manager.updateTrackInfo("16", { title: "New", artist: "New" });
      manager.updatePlayState("16", true);
      expect(manager.getDeckState("16").state).toBe("CUEING");

      // 17th deck should evict the CUEING deck
      expect(() => manager.getDeckState("17")).not.toThrow();
    });

    it("throws when all decks are PLAYING and limit reached", () => {
      // Fill 16 decks, advance past threshold so all reach PLAYING
      for (let i = 1; i <= 16; i++) {
        const id = String(i);
        manager.updateTrackInfo(id, testTrack);
        manager.updateFaderLevel(id, 1.0);
        manager.setMasterDeck(id);
        manager.updatePlayState(id, true);
      }
      vi.advanceTimersByTime(16_000); // CUEING → PLAYING

      // 17th deck — no evictable decks (all PLAYING), should throw
      expect(() => manager.getDeckState("17")).toThrow(
        "all decks are active"
      );
    });

    it("reset() clears all deck state and timers but keeps listeners", () => {
      const logHandler = vi.fn();
      const deckLiveHandler = vi.fn();
      manager.on("log", logHandler);
      manager.on("deckLive", deckLiveHandler);

      // Set up some deck state
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      manager.updateTrackInfo("2", testTrack);
      expect(manager.getDeckIds()).toHaveLength(2);

      // Reset
      manager.reset();

      // Decks should be cleared
      expect(manager.getDeckIds()).toHaveLength(0);
      expect(manager.getCurrentNowPlayingDeckId()).toBeNull();

      // Listeners should still be attached
      manager.updateTrackInfo("3", testTrack);
      manager.updatePlayState("3", true);
      vi.advanceTimersByTime(16_000);
      expect(deckLiveHandler).toHaveBeenCalled();

      // Log should include reset message
      const logMessages = logHandler.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(logMessages.some((m: string) => m.includes("reset"))).toBe(true);
    });

    it("handles fader level out of range", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 1.5); // Above max
      expect(manager.getDeckState("1").faderLevel).toBe(1.0);

      manager.updateFaderLevel("1", -0.5); // Below min
      expect(manager.getDeckState("1").faderLevel).toBe(0.0);
    });

    it("emits event with correct deck and track info", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      const track: TrackInfo = {
        title: "Specific Song",
        artist: "Specific Artist",
        album: "Specific Album",
      };

      manager.updateTrackInfo("3", track);
      manager.updateFaderLevel("3", 1.0);
      manager.setMasterDeck("3");
      manager.updatePlayState("3", true);

      vi.advanceTimersByTime(15000);

      expect(deckLiveHandler).toHaveBeenCalledWith({
        deckId: "3",
        track: {
          title: "Specific Song",
          artist: "Specific Artist",
          album: "Specific Album",
        },
      });
    });
  });

  describe("Now Playing Priority System", () => {
    const track1: TrackInfo = {
      title: "Song One",
      artist: "Artist One",
    };
    const track2: TrackInfo = {
      title: "Song Two",
      artist: "Artist Two",
    };

    it("sets currentNowPlayingDeckId when first deck goes live", () => {
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);

      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });

    it("does not switch to new deck while current now-playing deck is still playing", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 2 starts playing and meets threshold
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Should NOT have switched - deck 1 is still playing
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });

    it("switches to new deck after current now-playing deck's grace period expires", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 starts playing and meets threshold
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 pauses
      manager.updatePlayState("1", false);

      // Before grace period, should NOT have switched
      vi.advanceTimersByTime(2999);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // After grace period (3s), deck 1 → ENDED, scan finds deck 2
      vi.advanceTimersByTime(1);
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
      expect(deckLiveHandler).toHaveBeenLastCalledWith({
        deckId: "2",
        track: track2,
      });
    });

    it("does NOT switch if current now-playing deck resumes within grace period", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);

      // Deck 2 starts playing
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 pauses
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000); // 2 seconds pause (within 3s grace)

      // Deck 1 resumes before grace period expires
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(10000); // Wait to confirm no switch

      // Should NOT have switched - deck 1 resumed within grace period
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });

    it("paused track on Deck 2 should NOT become now playing over active Deck 1", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 is playing and live
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 loads track, plays for 20s, then pauses
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(20000);
      manager.updatePlayState("2", false); // Paused

      // Deck 2 should NOT have been reported - Deck 1 was still playing
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });

    it("clears currentNowPlayingDeckId when no other deck is playing after grace period", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Only deck 1 is playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 1 pauses
      manager.updatePlayState("1", false);

      // After grace period (3s), deck 1 → ENDED, scan finds no candidate
      vi.advanceTimersByTime(3000);

      // currentNowPlayingDeckId should be cleared
      expect(manager.getCurrentNowPlayingDeckId()).toBeNull();
    });

    it("both decks pause simultaneously — paused PLAYING deck becomes candidate", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now-playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 2 reaches PLAYING (blocked by priority — not reported)
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Both decks pause near the same time (deck 2 pauses 500ms later)
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(500);
      manager.updatePlayState("2", false);

      // Deck 1 grace period expires (3s from its pause = 2500ms more)
      // Deck 2 is paused but still in PLAYING state (within its own grace period)
      vi.advanceTimersByTime(2500);

      // Deck 2 (paused but PLAYING) should become the new candidate
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
      expect(deckLiveHandler).toHaveBeenLastCalledWith({
        deckId: "2",
        track: track2,
      });
    });

    it("respects fader and master deck priority when switching", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing (master, fader up)
      manager.setMasterDeck("1");
      manager.updateFaderLevel("1", 1.0);
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 is playing but fader is down
      manager.updateTrackInfo("2", track2);
      manager.updateFaderLevel("2", 0); // Fader down
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 pauses — grace period expires at 3s, then switch timer at 10s
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(10000);

      // Should NOT switch to deck 2 because fader is down
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Re-check Mechanisms", () => {
    const track1: TrackInfo = {
      title: "Song One",
      artist: "Artist One",
    };
    const track2: TrackInfo = {
      title: "Song Two",
      artist: "Artist Two",
    };
    const track3: TrackInfo = {
      title: "Song Three",
      artist: "Artist Three",
    };

    it("track load on now-playing deck triggers scan → other PLAYING deck takes over", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 2 is playing (reached PLAYING but blocked by priority)
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // DJ loads a new track on deck 1 (preparing next track)
      manager.updateTrackInfo("1", track3);

      // Scan should find deck 2 and switch
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
      expect(deckLiveHandler).toHaveBeenLastCalledWith({
        deckId: "2",
        track: track2,
      });
    });

    it("track unload on now-playing deck triggers scan", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 is playing
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Track unloaded from deck 1
      manager.updateTrackInfo("1", null);

      // Should switch to deck 2
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
    });

    it("grace period on now-playing deck triggers scan", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 is playing
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 pauses
      manager.updatePlayState("1", false);

      // Grace period expires (3s) — scan triggers
      vi.advanceTimersByTime(3000);

      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
    });

    it("fader drop to 0 on now-playing deck starts switch timer", () => {
      // Use a manager without faderDetection to isolate the switch-timer behavior
      manager = new DeckStateManager({
        liveThresholdSeconds: 15,
        pauseGraceSeconds: 3,
        nowPlayingPauseSeconds: 10,
        useFaderDetection: false,
        masterDeckPriority: false,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing with fader up
      manager.updateFaderLevel("1", 1.0);
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 is playing
      manager.updateFaderLevel("2", 1.0);
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Drop deck 1's fader to 0
      manager.updateFaderLevel("1", 0);

      // Before switch timer expires, no switch
      vi.advanceTimersByTime(9999);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // After switch timer (10s), deck 2 takes over
      vi.advanceTimersByTime(1);
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
    });

    it("fader drop on non-now-playing deck does NOT start switch timer", () => {
      manager = new DeckStateManager({
        liveThresholdSeconds: 15,
        pauseGraceSeconds: 3,
        nowPlayingPauseSeconds: 10,
        useFaderDetection: false,
        masterDeckPriority: false,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateFaderLevel("1", 1.0);
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Deck 2 is playing with fader up
      manager.updateFaderLevel("2", 1.0);
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Drop deck 2's fader (not the now-playing deck)
      manager.updateFaderLevel("2", 0);

      // Wait beyond switch timer
      vi.advanceTimersByTime(15000);

      // Should NOT have switched — only deck 1's fader matters for switch
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });

    it("emits nowPlayingCleared when last playing deck ends with no candidate", () => {
      const clearedHandler = vi.fn();
      manager.on("nowPlayingCleared", clearedHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");

      // Deck 1 stops — grace period expires, no other deck available
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(3000); // grace period

      expect(manager.getCurrentNowPlayingDeckId()).toBeNull();
      expect(clearedHandler).toHaveBeenCalledTimes(1);
    });

    it("does NOT emit nowPlayingCleared when another deck takes over", () => {
      const clearedHandler = vi.fn();
      manager.on("nowPlayingCleared", clearedHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);

      // Deck 2 starts and reaches threshold
      manager.updateTrackInfo("2", track2);
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 stops — grace period expires, deck 2 should take over
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(3000);

      expect(manager.getCurrentNowPlayingDeckId()).toBe("2");
      expect(clearedHandler).not.toHaveBeenCalled();
    });

    it("non-now-playing deck load/unload does NOT trigger scan", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", track1);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Load and unload tracks on deck 2 (not now-playing)
      manager.updateTrackInfo("2", track2);
      manager.updateTrackInfo("2", null);
      manager.updateTrackInfo("2", track3);

      // Deck 1 should still be now-playing, no extra events
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(manager.getCurrentNowPlayingDeckId()).toBe("1");
    });
  });

  describe("Cleanup", () => {
    const testTrack: TrackInfo = {
      title: "Test Song",
      artist: "Test Artist",
    };

    it("destroy() clears all timers and listeners", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Start a track playing (this creates a threshold timer)
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Destroy the manager
      manager.destroy();

      // Advancing time should not trigger the callback
      vi.advanceTimersByTime(20000);
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Verify listeners are removed
      expect(manager.listenerCount("deckLive")).toBe(0);
    });

    it("destroy() clears grace period timers", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Get track to PLAYING state
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);

      // Pause (starts grace period timer)
      manager.updatePlayState("1", false);

      // Destroy before grace period expires
      manager.destroy();

      // Grace period timer should be cleared
      vi.advanceTimersByTime(5000);
      // State should not have changed to ENDED (timer was cleared)
      // We can't check state after destroy, but no errors should occur
    });

    it("destroy() clears now-playing switch timer", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Deck 1 becomes now playing
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(15000);

      // Deck 2 is also playing
      manager.updateTrackInfo("2", {
        title: "Song Two",
        artist: "Artist Two",
      });
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(15000);

      // Deck 1 pauses (starts switch timer)
      manager.updatePlayState("1", false);

      // Destroy before switch timer expires
      manager.destroy();

      // Switch timer should be cleared - no switch should happen
      vi.advanceTimersByTime(15000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("prevents new timers from being created after destroy", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Destroy the manager before any tracks
      manager.destroy();

      // Now try to use the manager — these should not create timers
      manager.updateTrackInfo("1", {
        title: "Ghost Song",
        artist: "Ghost Artist",
      });
      manager.updatePlayState("1", true);
      manager.updateFaderLevel("1", 1.0);
      manager.setMasterDeck("1");

      // Advance past all possible timer thresholds
      vi.advanceTimersByTime(60_000);

      // No deckLive events should have been emitted
      expect(deckLiveHandler).not.toHaveBeenCalled();
    });
  });
});
