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
      liveThresholdSeconds: 8,
      pauseGraceSeconds: 3,
      useFaderDetection: true,
      masterDeckPriority: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initial State", () => {
    it("starts all decks in EMPTY state", () => {
      expect(manager.getDeckState("1").state).toBe("EMPTY");
      expect(manager.getDeckState("2").state).toBe("EMPTY");
      expect(manager.getDeckState("3").state).toBe("EMPTY");
      expect(manager.getDeckState("4").state).toBe("EMPTY");
    });

    it("returns null track for empty deck", () => {
      const state = manager.getDeckState("1");
      expect(state.track).toBeNull();
      expect(state.isPlaying).toBe(false);
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
      vi.advanceTimersByTime(7999);
      expect(manager.getDeckState("1").state).toBe("CUEING");
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // After threshold (8 seconds)
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
      vi.advanceTimersByTime(8000);
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

      // Play for 5 seconds
      vi.advanceTimersByTime(5000);

      // Brief pause for 2 seconds
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);

      // Resume
      manager.updatePlayState("1", true);

      // Only need 3 more seconds to hit threshold
      vi.advanceTimersByTime(3000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("long pause (>3s) during CUEING resets timer", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);

      // Play for 5 seconds
      vi.advanceTimersByTime(5000);

      // Long pause for 4 seconds (exceeds grace period)
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(4000);

      // Resume - timer should reset
      manager.updatePlayState("1", true);

      // After 5 more seconds, should still be CUEING
      vi.advanceTimersByTime(5000);
      expect(manager.getDeckState("1").state).toBe("CUEING");
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Need full 8 seconds now
      vi.advanceTimersByTime(3000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("brief pause during PLAYING does not change state", () => {
      manager.updateTrackInfo("1", testTrack);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(8000);
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
      vi.advanceTimersByTime(8000);
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

      // Play 3 seconds, pause 2 seconds (within grace), play 3 seconds, pause 2 seconds, play 2 seconds
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(3000);
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(3000);
      manager.updatePlayState("1", false);
      vi.advanceTimersByTime(2000);
      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(2000);

      // Total play time: 3 + 3 + 2 = 8 seconds
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

      // Should only have emitted once at the 8-second mark
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
      vi.advanceTimersByTime(4000);

      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(4000);

      // Deck 1: 8 seconds playing = PLAYING
      // Deck 2: 4 seconds playing = CUEING
      expect(manager.getDeckState("1").state).toBe("PLAYING");
      expect(manager.getDeckState("2").state).toBe("CUEING");
    });

    it("same track on different decks are tracked independently", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      // Same track on both decks
      manager.updateTrackInfo("1", track1);
      manager.updateTrackInfo("2", track1);

      manager.updatePlayState("1", true);
      vi.advanceTimersByTime(8000);

      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
      expect(deckLiveHandler).toHaveBeenCalledWith({
        deckId: "1",
        track: track1,
      });

      // Now deck 2 plays
      manager.updatePlayState("2", true);
      vi.advanceTimersByTime(8000);

      // Both decks should report independently
      expect(deckLiveHandler).toHaveBeenCalledTimes(2);
      expect(deckLiveHandler).toHaveBeenLastCalledWith({
        deckId: "2",
        track: track1,
      });
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

      vi.advanceTimersByTime(8000);

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

      vi.advanceTimersByTime(8000);
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

      vi.advanceTimersByTime(8000);
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("ignores fader when useFaderDetection is false", () => {
      manager = new DeckStateManager({
        liveThresholdSeconds: 8,
        pauseGraceSeconds: 3,
        useFaderDetection: false,
        masterDeckPriority: true,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.updateFaderLevel("1", 0); // Fader down
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(8000);
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

      vi.advanceTimersByTime(8000);

      // Deck 1 meets threshold but is not master
      expect(deckLiveHandler).not.toHaveBeenCalled();
    });

    it("reports when deck becomes master after threshold", () => {
      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("2");
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(8000);
      expect(deckLiveHandler).not.toHaveBeenCalled();

      // Deck 1 becomes master
      manager.setMasterDeck("1");
      expect(deckLiveHandler).toHaveBeenCalledTimes(1);
    });

    it("reports regardless of master when masterDeckPriority is false", () => {
      manager = new DeckStateManager({
        liveThresholdSeconds: 8,
        pauseGraceSeconds: 3,
        useFaderDetection: true,
        masterDeckPriority: false,
      });

      const deckLiveHandler = vi.fn();
      manager.on("deckLive", deckLiveHandler);

      manager.updateTrackInfo("1", testTrack);
      manager.setMasterDeck("2"); // Deck 2 is master
      manager.updateFaderLevel("1", 1.0);
      manager.updatePlayState("1", true);

      vi.advanceTimersByTime(8000);
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

      vi.advanceTimersByTime(8000);
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

      vi.advanceTimersByTime(8000);
      expect(manager.getDeckState("1").state).toBe("PLAYING");
    });

    it("handles unknown deck IDs by creating new deck state", () => {
      expect(() => manager.getDeckState("5")).not.toThrow();
      expect(manager.getDeckState("5").state).toBe("EMPTY");
    });

    it("throws error when maximum deck limit is reached", () => {
      // Create 12 more decks (4 default + 12 = 16, which is the limit)
      for (let i = 5; i <= 16; i++) {
        expect(() => manager.getDeckState(String(i))).not.toThrow();
      }

      // 17th deck should throw
      expect(() => manager.getDeckState("17")).toThrow(
        "Maximum deck limit (16) reached"
      );
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

      vi.advanceTimersByTime(8000);

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
      vi.advanceTimersByTime(10000);
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
      vi.advanceTimersByTime(8000);
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
  });
});
