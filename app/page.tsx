"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const [name, setName] = useState("");
  const [participantPassword, setParticipantPassword] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [message, setMessage] = useState("");

  async function handleParticipantLogin() {
    setMessage("");

    const cleanName = name.trim();

    if (!cleanName) {
      setMessage("Please enter your name.");
      return;
    }

    const { data: config, error: configError } = await supabase
      .from("game_config")
      .select("*")
      .eq("room_code", "default-room")
      .single();

    if (configError || !config) {
      console.error("Participant config error:", configError);
      setMessage(
        `Could not load game configuration: ${configError?.message || "No config row found."}`
      );
      return;
    }

    if (participantPassword !== config.participant_pin) {
      setMessage("Participant password is incorrect.");
      return;
    }

    const { data: existingParticipant, error: existingParticipantError } =
      await supabase
        .from("participants")
        .select("*")
        .eq("room_code", "default-room")
        .eq("display_name", cleanName)
        .maybeSingle();

    if (existingParticipantError) {
      console.error("Participant lookup error:", existingParticipantError);
      setMessage(
        `Could not check participant: ${existingParticipantError.message}`
      );
      return;
    }

    if (existingParticipant?.is_removed) {
      setMessage(
        "This participant name was removed by the admin. Use another name."
      );
      return;
    }

    if (!existingParticipant) {
      const { error: insertError } = await supabase.from("participants").insert({
        room_code: "default-room",
        display_name: cleanName,
      });

      if (insertError) {
        console.error("Participant insert error:", insertError);
        setMessage(`Could not create participant: ${insertError.message}`);
        return;
      }
    }

    sessionStorage.setItem("macro_role", "participant");
    sessionStorage.setItem("macro_name", cleanName);
    window.location.href = "/student";
  }

  async function handleAdminLogin() {
    setMessage("");

    const { data: config, error } = await supabase
      .from("game_config")
      .select("*")
      .eq("room_code", "default-room")
      .single();

    if (error || !config) {
      console.error("Admin config error:", error);
      setMessage(
        `Could not load admin configuration: ${
          error?.message || "No config row found."
        }`
      );
      return;
    }

    if (adminPin !== config.admin_pin) {
      setMessage("Admin PIN is incorrect.");
      return;
    }

    sessionStorage.setItem("macro_role", "admin");
    window.location.href = "/admin";
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Aggregate Demand Classroom Game
          </h1>
          <p className="mx-auto max-w-3xl text-base leading-7 text-slate-800">
            After all entries are collected, the app computes aggregate
            consumption, investment, aggregate demand, income, and each
            participant&apos;s consumption-saving split.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-slate-950">
              Participant login
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Your name
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 placeholder-slate-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Participant password
                </label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 placeholder-slate-500"
                  value={participantPassword}
                  onChange={(e) => setParticipantPassword(e.target.value)}
                  placeholder="Enter shared password"
                />
              </div>
              <button
                onClick={handleParticipantLogin}
                className="w-full rounded-lg bg-black px-4 py-3 font-medium text-white"
              >
                Enter as participant
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-slate-950">
              Admin login
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Admin PIN
                </label>
                <input
                  type="password"
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 placeholder-slate-500"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value)}
                  placeholder="Enter admin PIN"
                />
              </div>
              <button
                onClick={handleAdminLogin}
                className="w-full rounded-lg bg-slate-800 px-4 py-3 font-medium text-white"
              >
                Enter as admin
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}