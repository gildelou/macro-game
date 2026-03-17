"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type GameConfig = {
  room_code: string;
  game_title: string;
  admin_pin: string;
  participant_pin: string;
  fixed_investment_per_participant: number;
  fixed_income_component_per_participant: number;
  max_rounds: number;
  current_round: number;
  game_finished: boolean;
};

type Participant = {
  id: string;
  room_code: string;
  display_name: string;
  is_removed: boolean;
  created_at: string;
};

type Submission = {
  id: string;
  room_code: string;
  round_number: number;
  participant_id: string;
  consumption: number;
  created_at: string;
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
  created_at: string;
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
  created_at: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function AdminPage() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadAll() {
    const role = sessionStorage.getItem("macro_role");
    if (role !== "admin") {
      setMessage("Your admin session was not found. Please log in again.");
      setLoading(false);
      return;
    }

    const { data: configData } = await supabase
      .from("game_config")
      .select("*")
      .eq("room_code", "default-room")
      .single();

    const { data: participantData } = await supabase
      .from("participants")
      .select("*")
      .eq("room_code", "default-room")
      .order("created_at", { ascending: true });

    const { data: submissionData } = await supabase
      .from("submissions")
      .select("*")
      .eq("room_code", "default-room")
      .order("round_number", { ascending: true });

    const { data: roundData } = await supabase
      .from("rounds")
      .select("*")
      .eq("room_code", "default-room")
      .order("round_number", { ascending: true });

    const { data: resultData } = await supabase
      .from("round_results")
      .select("*")
      .eq("room_code", "default-room")
      .order("round_number", { ascending: true });

    setConfig(configData || null);
    setParticipants(participantData || []);
    setSubmissions(submissionData || []);
    setRounds(roundData || []);
    setResults(resultData || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("admin-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_config" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rounds" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_results" },
        () => loadAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeParticipants = participants.filter((p) => !p.is_removed);
  const currentRound = config?.current_round ?? 1;
  const currentRoundRow =
    rounds.find((r) => r.round_number === currentRound) || null;
  const currentRoundSubmissions = submissions.filter(
    (s) => s.round_number === currentRound
  );
  const submittedCount = currentRoundSubmissions.length;
  const allSubmitted =
    activeParticipants.length > 0 &&
    activeParticipants.every((p) =>
      currentRoundSubmissions.some((s) => s.participant_id === p.id)
    );

  const leaderboard = useMemo(() => {
    return activeParticipants
      .map((participant) => {
        const participantResults = results.filter(
          (r) => r.participant_id === participant.id
        );
        const roundsPlayed = participantResults.length;

        const avgConsumption =
          roundsPlayed > 0
            ? round2(
                participantResults.reduce(
                  (sum, r) => sum + Number(r.consumption_share),
                  0
                ) / roundsPlayed
              )
            : 0;

        const avgSaving =
          roundsPlayed > 0
            ? round2(
                participantResults.reduce(
                  (sum, r) => sum + Number(r.saving_share),
                  0
                ) / roundsPlayed
              )
            : 0;

        const avgDistance =
          roundsPlayed > 0
            ? round2(
                participantResults.reduce(
                  (sum, r) => sum + Number(r.distance_to_target),
                  0
                ) / roundsPlayed
              )
            : 9999;

        return {
          participantId: participant.id,
          participantName: participant.display_name,
          roundsPlayed,
          avgConsumption,
          avgSaving,
          avgDistance,
        };
      })
      .sort((a, b) => a.avgDistance - b.avgDistance);
  }, [activeParticipants, results]);

  async function closeRound() {
    if (!config) return;
    setMessage("");

    if (!allSubmitted) {
      setMessage("Not all active participants have submitted yet.");
      return;
    }

    const aggregateConsumption = currentRoundSubmissions.reduce(
      (sum, s) => sum + Number(s.consumption),
      0
    );

    const additionalInvestment =
      activeParticipants.length * config.fixed_investment_per_participant;

    const aggregateDemand = aggregateConsumption + additionalInvestment;

    const incomePerParticipant =
      activeParticipants.length > 0
        ? aggregateConsumption / activeParticipants.length +
          config.fixed_income_component_per_participant
        : config.fixed_income_component_per_participant;

    const { error: upsertRoundError } = await supabase
      .from("rounds")
      .upsert(
        {
          room_code: "default-room",
          round_number: currentRound,
          is_closed: true,
          aggregate_consumption: round2(aggregateConsumption),
          additional_investment: round2(additionalInvestment),
          aggregate_demand: round2(aggregateDemand),
          income_per_participant: round2(incomePerParticipant),
        },
        { onConflict: "room_code,round_number" }
      );

    if (upsertRoundError) {
      setMessage(`Could not close the round: ${upsertRoundError.message}`);
      return;
    }

    console.log("Round closed:", currentRound);

    const resultRows = activeParticipants.map((participant) => {
      const submission = currentRoundSubmissions.find(
        (s) => s.participant_id === participant.id
      );
      const consumption = Number(submission?.consumption || 0);
      const income = round2(incomePerParticipant);
      const savingAmount = round2(income - consumption);
      const consumptionShare =
        income === 0 ? 0 : round2((consumption / income) * 100);
      const savingShare =
        income === 0 ? 0 : round2((savingAmount / income) * 100);
      const distanceToTarget = round2(Math.abs(consumptionShare - 80));

      return {
        room_code: "default-room",
        round_number: currentRound,
        participant_id: participant.id,
        participant_name: participant.display_name,
        consumption,
        income,
        saving_amount: savingAmount,
        consumption_share: consumptionShare,
        saving_share: savingShare,
        distance_to_target: distanceToTarget,
      };
    });

    const { error: resultError } = await supabase
      .from("round_results")
      .upsert(resultRows, { onConflict: "room_code,round_number,participant_id" });

    if (resultError) {
      setMessage(`Round closed, but saving results failed: ${resultError.message}`);
      return;
    }

    setMessage(`Round ${currentRound} closed successfully.`);
    await loadAll();
  }

  async function openNextRound() {
    if (!config) return;
    setMessage("");

    const nextRound = currentRound + 1;
    const finished = nextRound > config.max_rounds;

    const { error } = await supabase
      .from("game_config")
      .update({
        current_round: finished ? config.max_rounds + 1 : nextRound,
        game_finished: finished,
      })
      .eq("room_code", "default-room");

    if (error) {
      setMessage(`Could not advance to the next round: ${error.message}`);
      return;
    }

    if (!finished) {
      const { error: nextRoundError } = await supabase
        .from("rounds")
        .upsert(
          {
            room_code: "default-room",
            round_number: nextRound,
            is_closed: false,
          },
          { onConflict: "room_code,round_number" }
        );

      if (nextRoundError) {
        setMessage(`Round advanced, but could not initialize next round: ${nextRoundError.message}`);
        return;
      }
    }

    setMessage(finished ? "Game finished." : `Round ${nextRound} is now open.`);
    await loadAll();
  }

  async function removeParticipant(participantId: string) {
    setMessage("");

    const { error } = await supabase
      .from("participants")
      .update({ is_removed: true })
      .eq("id", participantId);

    if (error) {
      setMessage("Could not remove participant.");
      return;
    }

    setMessage("Participant removed.");
    await loadAll();
  }

  async function resetGame() {
    setMessage("");

    const confirmReset = window.confirm(
      "This will clear rounds, submissions, results, and reset the game. Continue?"
    );
    if (!confirmReset) return;

    await supabase.from("round_results").delete().eq("room_code", "default-room");
    await supabase.from("submissions").delete().eq("room_code", "default-room");
    await supabase.from("rounds").delete().eq("room_code", "default-room");
    await supabase
      .from("participants")
      .update({ is_removed: false })
      .eq("room_code", "default-room");

    const { error } = await supabase
      .from("game_config")
      .update({
        current_round: 1,
        game_finished: false,
      })
      .eq("room_code", "default-room");

    if (error) {
      setMessage("Could not reset the game.");
      return;
    }

    const { error: roundResetError } = await supabase
      .from("rounds")
      .upsert(
        {
          room_code: "default-room",
          round_number: 1,
          is_closed: false,
        },
        { onConflict: "room_code,round_number" }
      );

    if (roundResetError) {
      setMessage(`Game reset partially, but round 1 could not be recreated: ${roundResetError.message}`);
      return;
    }

    setMessage("Game reset.");
    await loadAll();
  }

  function logout() {
    sessionStorage.removeItem("macro_role");
    sessionStorage.removeItem("macro_name");
    window.location.href = "/";
  }

  if (loading) {
    return <main className="min-h-screen p-6">Loading...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin dashboard</h1>
            <p className="text-slate-600">
              Manage participants, rounds, submissions, and results.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={logout}
              className="rounded-lg border bg-white px-4 py-2"
            >
              Log out
            </button>
            <button
              onClick={resetGame}
              className="rounded-lg bg-red-600 px-4 py-2 text-white"
            >
              Reset game
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <div className="grid gap-4 md:grid-cols-5">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Round</div>
              <div className="text-2xl font-bold">
                {config?.game_finished ? config.max_rounds : currentRound} / {config?.max_rounds}
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Participants</div>
              <div className="text-2xl font-bold">{activeParticipants.length}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Submitted</div>
              <div className="text-2xl font-bold">{submittedCount}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Participant password</div>
              <div className="text-2xl font-bold">{config?.participant_pin}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">Target</div>
              <div className="text-2xl font-bold">80 / 20</div>
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {message}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border bg-white p-6 lg:col-span-2">
            <h2 className="text-xl font-semibold">Current round status</h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-slate-500">Current round</div>
                  <div className="text-2xl font-bold">{currentRound}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-slate-500">Submissions</div>
                  <div className="text-2xl font-bold">
                    {submittedCount} / {activeParticipants.length}
                  </div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-slate-500">Round status</div>
                  <div className="text-2xl font-bold">
                    {currentRoundRow?.is_closed ? "Closed" : "Open"}
                  </div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-slate-500">Game status</div>
                  <div className="text-2xl font-bold">
                    {config?.game_finished ? "Finished" : "Active"}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={closeRound}
                  disabled={!!currentRoundRow?.is_closed || !!config?.game_finished}
                  className="rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
                >
                  Close current round
                </button>
                <button
                  onClick={openNextRound}
                  disabled={!currentRoundRow?.is_closed || !!config?.game_finished}
                  className="rounded-lg bg-slate-700 px-4 py-3 text-white disabled:opacity-50"
                >
                  {currentRound >= (config?.max_rounds || 10) ? "Finish game" : "Open next round"}
                </button>
              </div>

              {currentRoundRow?.is_closed && (
                <div className="rounded-xl border p-4 text-sm">
                  <div>
                    Aggregate consumption: <strong>{currentRoundRow.aggregate_consumption}</strong>
                  </div>
                  <div>
                    Additional investment: <strong>{currentRoundRow.additional_investment}</strong>
                  </div>
                  <div>
                    Aggregate demand: <strong>{currentRoundRow.aggregate_demand}</strong>
                  </div>
                  <div>
                    Income per participant: <strong>{currentRoundRow.income_per_participant}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-6">
            <h2 className="text-xl font-semibold">Participants</h2>
            <div className="mt-4 space-y-3">
              {activeParticipants.length === 0 && (
                <div className="text-sm text-slate-500">No active participants yet.</div>
              )}
              {activeParticipants.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between rounded-xl border p-3 text-sm"
                >
                  <div>{participant.display_name}</div>
                  <button
                    onClick={() => removeParticipant(participant.id)}
                    className="rounded-lg border px-3 py-1"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <h2 className="text-xl font-semibold">Current round submissions</h2>
          <div className="mt-4 space-y-3">
            {activeParticipants.map((participant) => {
              const submission = currentRoundSubmissions.find(
                (s) => s.participant_id === participant.id
              );

              return (
                <div
                  key={participant.id}
                  className="flex items-center justify-between rounded-xl border p-4 text-sm"
                >
                  <div className="font-medium">{participant.display_name}</div>
                  <div>
                    {submission ? (
                      <span>
                        Submitted: <strong>{submission.consumption}</strong>
                      </span>
                    ) : (
                      <span className="text-slate-500">Not yet submitted</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <h2 className="text-xl font-semibold">Leaderboard</h2>
          <div className="mt-4 space-y-3">
            {leaderboard.map((entry, index) => (
              <div
                key={entry.participantId}
                className="grid gap-3 rounded-xl border p-4 md:grid-cols-5"
              >
                <div className="font-semibold">
                  #{index + 1} {entry.participantName}
                </div>
                <div>Rounds: {entry.roundsPlayed}</div>
                <div>Avg consumption: {entry.avgConsumption}%</div>
                <div>Avg saving: {entry.avgSaving}%</div>
                <div>Distance to 80%: {entry.avgDistance}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <h2 className="text-xl font-semibold">Round history</h2>
          <div className="mt-4 space-y-6">
            {rounds.length === 0 && (
              <div className="text-sm text-slate-500">No rounds yet.</div>
            )}

            {rounds.map((round) => {
              const roundResultRows = results.filter(
                (result) => result.round_number === round.round_number
              );

              return (
                <div key={round.id} className="rounded-xl border p-4">
                  <div className="mb-3 text-lg font-semibold">
                    Round {round.round_number}
                  </div>

                  <div className="grid gap-3 text-sm md:grid-cols-4">
                    <div>
                      Aggregate consumption:{" "}
                      <strong>{round.aggregate_consumption ?? "Pending"}</strong>
                    </div>
                    <div>
                      Additional investment:{" "}
                      <strong>{round.additional_investment ?? "Pending"}</strong>
                    </div>
                    <div>
                      Aggregate demand:{" "}
                      <strong>{round.aggregate_demand ?? "Pending"}</strong>
                    </div>
                    <div>
                      Income per participant:{" "}
                      <strong>{round.income_per_participant ?? "Pending"}</strong>
                    </div>
                  </div>

                  {roundResultRows.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {roundResultRows.map((result) => (
                        <div
                          key={result.id}
                          className="grid gap-2 rounded-xl border p-3 text-sm md:grid-cols-6"
                        >
                          <div className="font-medium">{result.participant_name}</div>
                          <div>Consumption: {result.consumption}</div>
                          <div>Income: {result.income}</div>
                          <div>Consumed: {result.consumption_share}%</div>
                          <div>Saved: {result.saving_share}%</div>
                          <div>Distance: {result.distance_to_target}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {config?.game_finished && leaderboard[0] && (
          <div className="rounded-2xl border bg-white p-6">
            <h2 className="text-xl font-semibold">Winner</h2>
            <p className="mt-3 text-lg">
              <strong>{leaderboard[0].participantName}</strong> wins with an average
              distance of <strong>{leaderboard[0].avgDistance}</strong> from the 80%
              target.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}