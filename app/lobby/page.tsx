"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { createClient } from "@/lib/supabase/client";
import { displayName } from "@/lib/auth/username";
import { fetchRecentMatches, type MatchSummary } from "@/lib/history";
import { getRank } from "@/lib/ranks";
import RankProgress from "@/components/lobby/RankProgress";
import HowRoundWorks from "@/components/lobby/HowRoundWorks";
import RecentMatches from "@/components/lobby/RecentMatches";

export interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  wins: number;
  losses: number;
  mmr: number;
}

export default function LobbyPage() {
  const router = useRouter();
  const [largeCount, setLargeCount] = useState(2);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [isCreatingMatch, setIsCreatingMatch] = useState<boolean>(false);
  const [recentMatches, setRecentMatches] = useState<MatchSummary[]>([]);
  const [matchesLoading, setMatchesLoading] = useState<boolean>(true);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const challengeLink = matchId
    ? typeof window !== "undefined"
      ? `${window.location.origin}/match/${matchId}`
      : `/match/${matchId}`
    : "";

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function fetchUserProfile() {
      try {
        setLoading(true);
        setError(null);

        // 1. Get logged in auth user
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          throw new Error(authError?.message || "No active session found.");
        }

        // 2. Query matching profile row from database
        const { data, error: dbError } = await supabase
          .from("profiles")
          .select("id, username, wins, losses, mmr") // never `email`: it is private (see docs/sql/2026-10-21-lockdown-c1.sql)
          .eq("id", user.id)
          .maybeSingle();

        if (dbError) {
          throw dbError;
        }

        if (isMounted) {
          setProfile({
            id: user.id,
            email: user.email || "Operative", // own email comes from the login session, not the profiles table
            username: data?.username ?? null,
            wins: data?.wins ?? 0,
            losses: data?.losses ?? 0,
            mmr: data?.mmr ?? 1000,
          });
        }

        // 3. Last 5 finished matches. A failure here must not hide the profile.
        try {
          const recent = await fetchRecentMatches(supabase, user.id, 5);
          if (isMounted) setRecentMatches(recent);
        } catch (matchErr) {
          console.error("Failed to load recent matches:", matchErr);
          if (isMounted) setMatchesError("Could not load recent matches.");
        } finally {
          if (isMounted) setMatchesLoading(false);
        }
      } catch (err: any) {
        if (isMounted) setMatchesLoading(false);
        if (isMounted) {
          setError(err.message || "Failed to load user profile.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchUserProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreateChallenge = async () => {
    try {
      setIsCreatingMatch(true);
      setError(null);

      const supabase = createClient();

      // 1. Get the current authenticated user — player1_id must be their real UUID
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        setError("You must be logged in to create a match.");
        return;
      }

      // 2. Insert the real match row — this is what the socket server looks up
      //    on join_room. Without this row, the server returns error: not_found.
      const { data, error: insertError } = await supabase
        .from("matches")
        .insert({ player1_id: user.id, status: "pending" })
        .select("id")
        .single();

      if (insertError || !data?.id) {
        setError(
          insertError?.message ?? "Failed to create match. Please try again."
        );
        return;
      }

      // Set matchId so user can share link and cancel or enter room
      setMatchId(data.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsCreatingMatch(false);
    }
  };

  const handleCancelChallenge = async () => {
    if (!matchId) return;
    try {
      const supabase = createClient();
      await supabase
        .from("matches")
        .delete()
        .eq("id", matchId)
        .eq("status", "pending");
    } catch (err) {
      console.error("Failed to delete pending match on cancel:", err);
    } finally {
      setMatchId(null);
      setCopied(false);
    }
  };

  const copyLink = async () => {
    if (!challengeLink) return;
    await navigator.clipboard.writeText(challengeLink).catch(() => { });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-redirect host to match arena when second player joins
  useEffect(() => {
    if (!matchId) return;
    const supabase = createClient();
    let isMounted = true;

    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from("matches")
          .select("player2_id, status")
          .eq("id", matchId)
          .maybeSingle();

        if (!isMounted) return;
        if (data && (data.player2_id || data.status === "active")) {
          clearInterval(interval);
          router.push(`/match/${matchId}`);
        }
      } catch (err) {
        console.error("Error polling match presence:", err);
      }
    }, 1200);

    const channel = supabase
      .channel(`lobby_match_${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (!isMounted) return;
          const row = payload.new as {
            player2_id?: string | null;
            status?: string;
          };
          if (row && (row.player2_id || row.status === "active")) {
            clearInterval(interval);
            router.push(`/match/${matchId}`);
          }
        }
      )
      .subscribe();

    const handleBeforeUnload = () => {
      supabase
        .from("matches")
        .delete()
        .eq("id", matchId)
        .eq("status", "pending");
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      isMounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [matchId, router]);

  const handleQuickMatch = () => {
    router.push("/game");
  };

  return (
    <div className="bg-background text-on-background font-body-md min-h-screen flex flex-col selection:bg-primary-container selection:text-on-primary-container">
      <Navbar />

      {/* Main Content Grid */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-container-margin py-stack-lg grid grid-cols-12 gap-stack-lg items-start">
        {/* Left Column: Profile & Stats */}
        <section className="col-span-12 md:col-span-4 flex flex-col gap-stack-lg">
          <div className="glass-panel rounded-xl p-stack-lg flex flex-col items-center text-center gap-stack-md relative overflow-hidden group min-h-[320px] justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

            {loading ? (
              <div className="flex flex-col items-center gap-4 w-full animate-pulse py-4">
                <div className="w-28 h-28 rounded-full bg-surface-bright/30"></div>
                <div className="h-6 w-36 bg-surface-bright/30 rounded"></div>
                <div className="h-4 w-24 bg-surface-bright/20 rounded"></div>
                <div className="w-full grid grid-cols-3 gap-base mt-4 pt-4 border-t border-outline-variant/15">
                  <div className="h-10 bg-surface-bright/20 rounded"></div>
                  <div className="h-10 bg-surface-bright/20 rounded"></div>
                  <div className="h-10 bg-surface-bright/20 rounded"></div>
                </div>
              </div>
            ) : error || !profile ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <span className="material-symbols-outlined text-error text-3xl">
                  warning
                </span>
                <p className="text-error text-xs font-mono">
                  {error || "Unable to load profile"}
                </p>
              </div>
            ) : (
              <>
                <div
                  aria-label={`${displayName(profile)}'s Avatar`}
                  className="w-28 h-28 rounded-full border-2 border-primary-container bg-surface-container flex items-center justify-center mb-2 shadow-[0_0_15px_rgba(0,229,255,0.2)] select-none"
                >
                  <span className="font-headline-lg text-5xl font-bold text-primary-container">
                    {displayName(profile).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1
                    className="font-headline-lg text-lg sm:text-headline-lg text-primary font-bold truncate max-w-[240px]"
                    title={displayName(profile)}
                  >
                    {displayName(profile)}
                  </h1>
                  <span className="font-label-caps text-label-caps text-on-surface-variant mt-1 inline-block px-3 py-1 bg-surface-container rounded-full">
                    {getRank(profile.mmr).name}
                  </span>
                </div>
                <div className="w-full grid grid-cols-3 gap-base mt-4 pt-4 border-t border-outline-variant/15">
                  <div className="flex flex-col items-center">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">
                      Wins
                    </span>
                    <span className="font-mono-metric text-mono-metric text-primary-fixed-dim mt-1">
                      {profile.wins}
                    </span>
                  </div>
                  <div className="flex flex-col items-center border-l border-r border-outline-variant/15">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">
                      Losses
                    </span>
                    <span className="font-mono-metric text-mono-metric text-on-background mt-1">
                      {profile.losses}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-label-caps text-label-caps text-on-surface-variant">
                      MMR
                    </span>
                    <span className="font-mono-metric text-mono-metric text-primary-container mt-1 font-bold">
                      {profile.mmr}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {profile && !loading && !error && <RankProgress mmr={profile.mmr} />}
        </section>

        {/* Right Column: Config & Actions */}
        <section className="col-span-12 md:col-span-8 flex flex-col gap-stack-lg">
          {/* Game Mode Config */}


          {/* CTAs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack-lg">
            {/* Create Challenge */}
            <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md hover:-translate-y-1 transition-transform duration-300">
              <div className="w-12 h-12 rounded-full bg-secondary-container/20 flex items-center justify-center text-secondary mb-2">
                <span className="material-symbols-outlined">share</span>
              </div>
              <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-primary-fixed-dim">
                Create Challenge Link
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant flex-1">
                Generate a unique link to challenge your friends directly.
              </p>

              {!matchId ? (
                <div className="mt-4">
                  <button
                    onClick={handleCreateChallenge}
                    disabled={isCreatingMatch}
                    className="w-full bg-[#0A192F] border border-[#2962FF] hover:border-[#00E5FF] text-[#00E5FF] hover:bg-[#2962FF]/15 px-4 py-2.5 rounded-lg font-label-caps text-label-caps transition-all duration-200 h-[38px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.15)] hover:shadow-[0_0_18px_rgba(0,229,255,0.3)]"
                  >
                    {isCreatingMatch ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-sm">
                          progress_activity
                        </span>
                        <span>Creating Match...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">
                          add_link
                        </span>
                        <span>Create Challenge Link</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 mt-4">
                  <div className="flex items-center">
                    <input
                      type="text"
                      readOnly
                      value={challengeLink}
                      className="bg-background border border-outline-variant/30 rounded-l-lg py-2 px-3 font-mono text-on-surface-variant flex-1 truncate text-xs outline-none select-all"
                    />
                    <button
                      onClick={copyLink}
                      className="bg-[#0A192F] border border-[#2962FF] border-l-0 text-[#00E5FF] px-4 py-2 rounded-r-lg font-label-caps text-label-caps hover:bg-[#2962FF]/10 transition-colors h-[38px] flex items-center justify-center min-w-[90px]"
                    >
                      {copied ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E5FF] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00E5FF]"></span>
                    </span>
                    <span className="font-body-sm text-xs text-on-surface-variant">
                      Waiting for opponent to join...
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      onClick={handleCancelChallenge}
                      className="py-2 px-3 rounded-lg border border-outline-variant/40 hover:border-error hover:text-error text-on-surface-variant text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        close
                      </span>
                      Cancel Link
                    </button>
                    <button
                      onClick={() => router.push(`/match/${matchId}`)}
                      className="py-2 px-3 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary text-xs font-bold uppercase tracking-wider transition-all neon-glow flex items-center justify-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        swords
                      </span>
                      Enter Arena
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Solo Training / Practice Mode */}
            <div className="glass-panel rounded-xl p-stack-lg flex flex-col gap-stack-md hover:-translate-y-1 transition-transform duration-300">
              <div className="w-12 h-12 rounded-full bg-secondary-container/20 flex items-center justify-center text-secondary mb-2">
                <span className="material-symbols-outlined">psychology</span>
              </div>
              <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-primary-fixed-dim">
                Practice Mode
              </h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant flex-1">
                Sharpen your mental math, test strategies, experiment with
                operators, and solve puzzles at your own pace.
              </p>

              <div className="mt-4">
                <button
                  onClick={() => router.push("/training")}
                  className="w-full bg-[#0A192F] border border-[#2962FF] hover:border-[#00E5FF] text-[#00E5FF] hover:bg-[#2962FF]/15 px-4 py-2.5 rounded-lg font-label-caps text-label-caps transition-all duration-200 h-[38px] flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.15)] hover:shadow-[0_0_18px_rgba(0,229,255,0.3)]"
                >
                  <span className="material-symbols-outlined text-sm">
                    play_arrow
                  </span>
                  <span>Start Practice Session</span>
                </button>
              </div>
            </div>
          </div>

          <HowRoundWorks />

          {profile && (
            <RecentMatches
              matches={recentMatches}
              loading={matchesLoading}
              error={matchesError}
              userId={profile.id}
              onCreateChallenge={handleCreateChallenge}
              isCreatingChallenge={isCreatingMatch}
            />
          )}
        </section>
      </main>
    </div>
  );
}
