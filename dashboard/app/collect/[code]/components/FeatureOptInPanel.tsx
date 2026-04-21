"use client";

import { useState } from "react";
import { z } from "zod";

const emailSchema = z.string().email().max(254);

interface Props {
  hasEmail: boolean;
  onSave: (email: string) => Promise<void>;
}

export default function FeatureOptInPanel({ hasEmail, onSave }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (hasEmail || !expanded) return null;

  const submit = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError("Invalid email");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
      setExpanded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      style={{
        background: "#1a1a1a",
        padding: 16,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <h3>Get the most out of your picks</h3>
      <ul style={{ marginBottom: 12 }}>
        <li>Notify me when my song plays</li>
        <li>Cross-device &quot;my picks&quot; and leaderboard position</li>
        <li>Persistent profile across events</li>
      </ul>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ marginLeft: 8 }}
        />
      </label>
      {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setExpanded(false)} disabled={saving}>
          Keep it anonymous
        </button>
        <button onClick={submit} disabled={saving}>
          Add email
        </button>
      </div>
    </section>
  );
}
