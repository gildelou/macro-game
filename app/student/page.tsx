"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type GameConfig = {
  room_code: string;
  current_round: number;
  max_rounds: number;
  game_finished: boolean;
  fixed_income_component_per_participant: number;
};

type Participant = {
  id: string;
  display_name: string;
  is_removed: boolean;
};

type Submission = {
  id: string;
  room_code: string;
  round_number: number;
  participant_id: string;
  consumption: number;
};

type RoundRow = {
  id: string;
  room_code: string;
  round_number: number;
  is_closed: boolean;
  aggregate_consumption: number | null;
  additional_investment: number | null;
  aggregate_demand: number | null;
  income_per_participant: number | null;
};

type RoundResult = {
  id: string;
  room_code: string;
  round_number: number;
  participant_id: string;
  participant_name: string;
  consumption: number;
  income: number;
  saving_amount: number;
  consumption_share: number;
  saving_share: number;
  distance_to_target: number;
};

export default function StudentPage() {
  const [name, setName] = useState("");
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const storedName = sessionStorage.getItem("macro_name");
    const role = sessionStorage.getItem("macro_role");

  if (!storedName || role !== "participant") {
  setMessage("Your login session was not found. Please log in again.");
  setLoading(false);
  return;
}

    setName(storedName);

    const { data: participantData } = await supabase
      .from("participants")
      .select("*")
      .eq("room_code", "default-room")
      .eq("display_name", storedName)
      .maybeSingle();

    if (!participantData) {
  setMessage("Your participant record could not be found. Please log in again.");
  setLoading(false);
  return;
}

if (participantData.is_removed) {
  sessionStorage.removeItem("macro_name");
  sessionStorage.removeItem("macro_role");
  window.location.href = "/";
  return;
}

    setParticipant(participantData);

    const { data: configData } = await supabase
      .from("game_config")
      .select("*")
      .eq("room_code", "default-room")
      .single();

    if (configData) setConfig(configData);

    const { data: roundData } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_code", "default-room")
      .order("round_number", { ascending: true });

    setRounds(roundData || []);

    const { data: submissionData } = await supabase
      .from("submissions")
      .select("*")
      .eq("room_code", "default-room")
      .eq("participant_id", participantData.id)
      .order("round_number", { ascending: true });

    setSubmissions(submissionData || []);

    const { data: resultData } = await supabase
      .from("round_results")
      .select("*")
      .eq("room_code", "default-room")
      .eq("participant_id", participantData.id)
      .order("round_number", { ascending: true });

    setResults(resultData || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("student-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_config" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rounds" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_results" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants" },
        () => loadAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const currentRound = config?.current_round ?? 1;
  const currentRoundRow = rounds.find((r) => r.round_number === currentRound);
  const priorRound = rounds.find((r) => r.round_number === currentRound - 1);
  const alreadySubmitted = submissions.some((s) => s.round_number === currentRound);

  const currentResult = useMemo(() => {
    return results.find((r) => r.round_number === currentRound) || null;
  }, [results, currentRound]);

  const averages = useMemo(() => {
    if (results.length === 0) {
      return {
        avgConsumption: 0,
        avgSaving: 0,
        avgDistance: 0,
        roundsPlayed: 0,
      };
    }

    const sumConsumption = results.reduce((sum, r) => sum + Number(r.consumption_share), 0);
    const sumSaving = results.reduce((sum, r) => sum + Number(r.saving_share), 0);
    const sumDistance = results.reduce((sum, r) => sum + Number(r.distance_to_target), 0);

    return {
      avgConsumption: Math.round((sumConsumption / results.length) * 100) / 100,
      avgSaving: Math.round((sumSaving / results.length) * 100) / 100,
      avgDistance: Math.round((sumDistance / results.length) * 100) / 100,
      roundsPlayed: results.length,
    };
  }, [results]);

  async function handleSubmit() {
    setMessage("");

    if (!participant) return;

    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setMessage("Enter a whole number between 0 and 1000.");
      return;
    }

    if (alreadySubmitted) {
      setMessage("You already submitted for this round.");
      return;
    }

    const { error } = await supabase.from("submissions").insert({
  room_code: "default-room",
  round_number: currentRound,
  participant_id: participant.id,
  consumption: n,
});

if (error) {
  setMessage(`Could not save your submission: ${error.message}`);
  return;
}

console.log("Submission saved for participant:", participant.id, "round:", currentRound);

    setValue("");
    setMessage("Submission saved.");
    await loadAll();
  }

  function logout() {
  sessionStorage.removeItem("macro_name");
  sessionStorage.removeItem("macro_role");
  window.location.href = "/";
}

  if (loading) {
    return <main className="min-h-screen p-6">Loading...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Student dashboard</h1>
            <p className="text-slate-600">Welcome, {name}.</p>
          </div>
          <button
            onClick={logout}
            className="rounded-lg border bg-white px-4 py-2"
          >
            Log out
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5">
            <div className="text-sm text-slate-500">Goal</div>
            <div className="mt-2 text-3xl font-bold">80% / 20%</div>
            <p className="mt-2 text-sm text-slate-600">
              Try to get as close as possible to 80% consumption and 20% saving.
            </p>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-sm text-slate-500">Current round</div>
            <div className="mt-2 text-3xl font-bold">
              {config?.game_finished ? "Finished" : currentRound}
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Enter a whole number from 0 to 1000.
            </p>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-sm text-slate-500">Latest market signal</div>
            {priorRound ? (
              <div className="mt-2 space-y-1 text-sm">
                <div>Aggregate consumption: <strong>{priorRound.aggregate_consumption}</strong></div>
                <div>Additional investment: <strong>{priorRound.additional_investment}</strong></div>
                <div>Aggregate demand: <strong>{priorRound.aggregate_demand}</strong></div>
                <div>Income per participant: <strong>{priorRound.income_per_participant}</strong></div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                No previous round yet.
              </p>
            )}
          </div>
        </div>

        {!config?.game_finished && (
          <div className="rounded-2xl border bg-white p-6">
            <h2 className="text-xl font-semibold">Submit for round {currentRound}</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Consumption expenditure
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={alreadySubmitted ? "" : value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={alreadySubmitted || currentRoundRow?.is_closed}
                  className="w-full rounded-lg border p-3"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={alreadySubmitted || currentRoundRow?.is_closed}
                className="rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
              >
                {alreadySubmitted ? "Already submitted" : "Submit"}
              </button>
            </div>
          </div>
        )}

        {currentResult && (
          <div className="rounded-2xl border bg-white p-6">
            <h2 className="text-xl font-semibold">Your round {currentRound} result</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border p-4">
                <div className="text-sm text-slate-500">Income</div>
                <div className="text-2xl font-bold">{currentResult.income}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm text-slate-500">Consumed</div>
                <div className="text-2xl font-bold">{currentResult.consumption_share}%</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm text-slate-500">Saved</div>
                <div className="text-2xl font-bold">{currentResult.saving_share}%</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm text-slate-500">Distance to target</div>
                <div className="text-2xl font-bold">{currentResult.distance_to_target}</div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border bg-white p-6">
          <h2 className="text-xl font-semibold">Your performance so far</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Average consumption share</div>
              <div className="text-2xl font-bold">{averages.avgConsumption}%</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Average saving share</div>
              <div className="text-2xl font-bold">{averages.avgSaving}%</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Average distance</div>
              <div className="text-2xl font-bold">{averages.avgDistance}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Rounds played</div>
              <div className="text-2xl font-bold">{averages.roundsPlayed}</div>
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}