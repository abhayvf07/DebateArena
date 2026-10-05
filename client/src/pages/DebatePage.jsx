// Debate page — individual debate view with socket-powered arguments and voting
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDebateById,
  getArguments,
  createArgument,
  likeArgument,
  voteOnDebate,
  toggleBookmark,
  incrementView,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import ScoreBar from "../components/ScoreBar";
import ArgumentCard from "../components/ArgumentCard";
import { PageSkeleton } from "../components/SkeletonLoader";
import DebateAnalytics from "../components/DebateAnalytics";
import toast from "react-hot-toast";
import { getSocket } from "../socket/socket";

export default function DebatePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [newArg, setNewArg] = useState({ text: "", side: "Pro" });
  const [bookmarked, setBookmarked] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [argPage, setArgPage] = useState(1);

  useEffect(() => {
    const socket = getSocket(user?.accessToken || user?.token);

    const handleConnect = () => {
      socket.emit("joinDebate", id);
    };

    if (socket.connected) {
      socket.emit("joinDebate", id);
    } else {
      socket.on("connect", handleConnect);
    }

    socket.on("voteUpdated", (data) => {
      queryClient.setQueryData(["debate", id], (old) => {
        if (!old) return old;
        return {
          ...old,
          proVotes: data.proVotes,
          conVotes: data.conVotes,
        };
      });
    });

    socket.on("argumentAdded", (newArgument) => {
      if (newArgument.author?._id === user?._id) return;

      // Use setQueriesData with a predicate to match ["arguments", id, <any page>]
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "arguments" && query.queryKey[1] === id,
        },
        (old) => {
          if (!old) return old;
          if (!newArgument.parentId) {
            return {
              ...old,
              arguments: [newArgument, ...old.arguments],
            };
          }
          const newArgs = old.arguments.map((arg) => {
            if (arg._id === newArgument.parentId) {
              return { ...arg, replies: [...(arg.replies || []), newArgument] };
            }
            return arg;
          });
          return { ...old, arguments: newArgs };
        },
      );
    });

    socket.on("argumentDeleted", ({ argumentId }) => {
      // Use setQueriesData with a predicate to match ["arguments", id, <any page>]
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "arguments" && query.queryKey[1] === id,
        },
        (old) => {
          if (!old) return old;
          // Remove if top-level
          const filtered = old.arguments.filter(
            (arg) => arg._id !== argumentId,
          );
          // Remove if nested reply inside a parent
          const cleaned = filtered.map((arg) => {
            if (!arg.replies?.length) return arg;
            return {
              ...arg,
              replies: arg.replies.filter((r) => r._id !== argumentId),
            };
          });
          return { ...old, arguments: cleaned };
        },
      );
    });

    return () => {
      socket.emit("leaveDebate", id);
      socket.off("connect", handleConnect);
      socket.off("voteUpdated");
      socket.off("argumentAdded");
      socket.off("argumentDeleted");
    };
  }, [id, user, queryClient]);

  useEffect(() => {
    incrementView(id).catch(() => {});
  }, [id]);

  const { data: debate, isLoading: loadingDebate } = useQuery({
    queryKey: ["debate", id],
    queryFn: async () => {
      const res = await getDebateById(id, user?._id);
      return res.data;
    },
  });

  const { data: argsData, isLoading: loadingArgs } = useQuery({
    queryKey: ["arguments", id, argPage],
    queryFn: async () => {
      const res = await getArguments(id, user?._id, argPage);
      return res.data;
    },
    initialData: { arguments: [], userLikes: {}, totalPages: 1, page: 1 },
  });

  const addArgumentMutation = useMutation({
    mutationFn: (data) => createArgument(data),
    onSuccess: () => {
      setNewArg({ text: "", side: "Pro" });
      toast.success("Argument posted!");
      queryClient.invalidateQueries({ queryKey: ["arguments", id] });
    },
    onError: (err) => {
      const msg = err.response?.data?.message || "Failed to post argument";
      toast.error(msg);
    },
  });

  const voteMutation = useMutation({
    mutationFn: (side) => voteOnDebate(id, side),
    onSuccess: (res) => {
      queryClient.setQueryData(["debate", id], (old) => ({
        ...old,
        proVotes: res.data.proVotes,
        conVotes: res.data.conVotes,
        userVoteSide: res.data.userVoteSide,
      }));

      if (res.data.alert) toast(res.data.alert);
      else
        toast.success(
          res.data.userVoteSide
            ? `Voted ${res.data.userVoteSide}!`
            : "Vote removed",
        );
    },
    onError: (err) => {
      const msg =
        err.response?.data?.message || "Vote failed. Please try again.";
      toast.error(msg);
    },
  });

  const likeMutation = useMutation({
    mutationFn: (argumentId) => likeArgument(argumentId),
    onSuccess: (res) => {
      toast.success(res.data.liked ? "❤️ Liked!" : "Unliked");
      if (res.data.alert) toast(res.data.alert);
      queryClient.invalidateQueries({ queryKey: ["arguments", id] });
    },
    onError: (err) => {
      const msg =
        err.response?.data?.message || "Like failed. Please try again.";
      toast.error(msg);
    },
  });

  const handleSubmitArg = (e) => {
    e.preventDefault();
    if (!newArg.text.trim()) return;
    addArgumentMutation.mutate({
      debateId: id,
      text: newArg.text,
      side: newArg.side,
    });
  };

  const handleLike = (argumentId) => {
    if (likeMutation.isPending) return;
    likeMutation.mutate(argumentId);
  };

  const handleBookmark = async () => {
    try {
      const res = await toggleBookmark(id);
      setBookmarked(res.data.bookmarked);
      toast.success(
        res.data.bookmarked ? "🔖 Bookmarked!" : "Bookmark removed",
      );
    } catch (err) {
      const msg = err.response?.data?.message || "Bookmark failed";
      toast.error(msg);
    }
  };

  if (loadingDebate) {
    return <PageSkeleton />;
  }

  if (!debate) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "4rem",
          color: "var(--text-muted)",
        }}
      >
        Debate not found.
      </div>
    );
  }

  const { arguments: args, userLikes } = argsData;
  const proArgs = args.filter((a) => a.side === "Pro");
  const conArgs = args.filter((a) => a.side === "Con");

  const voteBtnStyle = (side) => {
    const isActive = debate.userVoteSide === side;
    const color = side === "Pro" ? "var(--pro-color)" : "var(--con-color)";
    const bg = side === "Pro" ? "var(--pro-bg)" : "var(--con-bg)";
    return {
      padding: "0.6rem 1.5rem",
      borderRadius: "10px",
      cursor: "pointer",
      border: `2px solid ${isActive ? color : "var(--border)"}`,
      background: isActive ? bg : "transparent",
      color: isActive ? color : "var(--text-muted)",
      fontWeight: 700,
      fontSize: "0.95rem",
      transition: "all 0.2s ease",
      display: "flex",
      alignItems: "center",
      gap: "0.4rem",
    };
  };

  return (
    <div
      style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}
    >
      <div
        className="glass animate-in"
        style={{ padding: "2rem", marginBottom: "2rem" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginBottom: "0.75rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span className="badge badge-category">{debate.category}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                💬 {debate.argumentsCount || 0} arguments · 👁️{" "}
                {debate.views || 0} views
              </span>
            </div>

            {debate.tags && debate.tags.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "0.35rem",
                  marginBottom: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                {debate.tags.map((tag) => (
                  <span key={tag} className="badge badge-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                marginBottom: "0.75rem",
                lineHeight: 1.3,
              }}
            >
              {debate.title}
            </h1>
            <p
              style={{
                color: "var(--text-muted)",
                lineHeight: 1.6,
                marginBottom: "1rem",
              }}
            >
              {debate.description}
            </p>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Started by{" "}
              <strong style={{ color: "var(--text)" }}>
                {debate.creator?.name}
              </strong>{" "}
              · {new Date(debate.createdAt).toLocaleDateString()}
            </div>
          </div>

          {user && (
            <button
              onClick={handleBookmark}
              className="btn-ghost"
              style={{ fontSize: "1.1rem" }}
            >
              {bookmarked ? "🔖" : "🏷️"} {bookmarked ? "Saved" : "Save"}
            </button>
          )}
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <ScoreBar
            proScore={debate.proVotes || 0}
            conScore={debate.conVotes || 0}
          />
        </div>

        {user && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              marginTop: "1.25rem",
            }}
          >
            <button
              style={voteBtnStyle("Pro")}
              onClick={() => voteMutation.mutate("Pro")}
              disabled={voteMutation.isPending}
            >
              👍 Vote Pro ({debate.proVotes || 0})
            </button>
            <button
              style={voteBtnStyle("Con")}
              onClick={() => voteMutation.mutate("Con")}
              disabled={voteMutation.isPending}
            >
              👎 Vote Con ({debate.conVotes || 0})
            </button>
          </div>
        )}
        {debate.userVoteSide && (
          <p
            style={{
              textAlign: "center",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginTop: "0.5rem",
            }}
          >
            You voted{" "}
            <strong
              style={{
                color:
                  debate.userVoteSide === "Pro"
                    ? "var(--pro-color)"
                    : "var(--con-color)",
              }}
            >
              {debate.userVoteSide}
            </strong>{" "}
            · click again to remove
          </p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "1.5rem",
            borderTop: "1px solid var(--border)",
            paddingTop: "1.5rem",
          }}
        >
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className="btn-ghost"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.9rem",
            }}
          >
            {showAnalytics ? "Hide Analytics 📉" : "Show Analytics 📊"}
          </button>
        </div>
      </div>

      {showAnalytics && (
        <DebateAnalytics
          proVotes={debate.proVotes}
          conVotes={debate.conVotes}
          views={debate.views}
          argumentsCount={debate.argumentsCount}
        />
      )}

      {user && (
        <div
          className="glass animate-in"
          style={{ padding: "1.5rem", marginBottom: "2rem" }}
        >
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            💬 Add Your Argument
          </h3>
          <form onSubmit={handleSubmitArg}>
            <textarea
              className="input-field"
              value={newArg.text}
              onChange={(e) => setNewArg({ ...newArg, text: e.target.value })}
              placeholder="Make your case..."
              required
              style={{ marginBottom: "1rem" }}
            />
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setNewArg({ ...newArg, side: "Pro" })}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor:
                      newArg.side === "Pro"
                        ? "var(--pro-color)"
                        : "var(--border)",
                    background:
                      newArg.side === "Pro" ? "var(--pro-bg)" : "transparent",
                    color:
                      newArg.side === "Pro"
                        ? "var(--pro-color)"
                        : "var(--text-muted)",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    transition: "all 0.2s ease",
                  }}
                >
                  👍 Pro
                </button>
                <button
                  type="button"
                  onClick={() => setNewArg({ ...newArg, side: "Con" })}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor:
                      newArg.side === "Con"
                        ? "var(--con-color)"
                        : "var(--border)",
                    background:
                      newArg.side === "Con" ? "var(--con-bg)" : "transparent",
                    color:
                      newArg.side === "Con"
                        ? "var(--con-color)"
                        : "var(--text-muted)",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    transition: "all 0.2s ease",
                  }}
                >
                  👎 Con
                </button>
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={addArgumentMutation.isPending}
              >
                {addArgumentMutation.isPending ? "Posting..." : "Post Argument"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loadingArgs ? (
        <PageSkeleton />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "2rem",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                marginBottom: "1rem",
                color: "var(--pro-color)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              👍 Pro ({proArgs.length})
            </h2>
            {proArgs.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                No Pro arguments yet.
              </p>
            ) : (
              proArgs.map((arg) => (
                <ArgumentCard
                  key={arg._id}
                  argument={arg}
                  liked={!!userLikes[arg._id]}
                  onLike={handleLike}
                  onReplyAdded={() =>
                    queryClient.invalidateQueries({ queryKey: ["arguments", id] })
                  }
                />
              ))
            )}
          </div>

          <div>
            <h2
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                marginBottom: "1rem",
                color: "var(--con-color)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              👎 Con ({conArgs.length})
            </h2>
            {conArgs.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                No Con arguments yet.
              </p>
            ) : (
              conArgs.map((arg) => (
                <ArgumentCard
                  key={arg._id}
                  argument={arg}
                  liked={!!userLikes[arg._id]}
                  onLike={handleLike}
                  onReplyAdded={() =>
                    queryClient.invalidateQueries({ queryKey: ["arguments", id] })
                  }
                />
              ))
            )}
          </div>
        </div>
      )}

      {(argsData?.totalPages ?? 1) > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginTop: "1.5rem",
          }}
        >
          <button
            className="btn-secondary"
            onClick={() => setArgPage((p) => Math.max(1, p - 1))}
            disabled={argPage === 1}
          >
            ← Previous
          </button>
          <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>
            Page {argPage} of {argsData?.totalPages ?? 1}
          </span>
          <button
            className="btn-secondary"
            onClick={() => setArgPage((p) => p + 1)}
            disabled={argPage >= (argsData?.totalPages ?? 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}