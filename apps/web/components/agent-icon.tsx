import type { CSSProperties } from "react";
import type { StaticImageData } from "next/image";
import type { AgentSpec } from "@agents/spec";
import Information from "../../../agent-icons/svg/information-analysis.svg";
import Creation from "../../../agent-icons/svg/creation-communication.svg";
import Action from "../../../agent-icons/svg/action-automation.svg";
import Support from "../../../agent-icons/svg/support-oversight.svg";
import Planning from "../../../agent-icons/svg/planning-reasoning.svg";
import InformationGif from "../../../agent-icons/gif/information-analysis.gif";
import CreationGif from "../../../agent-icons/gif/creation-communication.gif";
import ActionGif from "../../../agent-icons/gif/action-automation.gif";
import SupportGif from "../../../agent-icons/gif/support-oversight.gif";
import PlanningGif from "../../../agent-icons/gif/planning-reasoning.gif";
const icons = {
  "information-analysis": Information,
  "creation-communication": Creation,
  "action-automation": Action,
  "support-oversight": Support,
  "planning-reasoning": Planning,
};
const gifs: Record<AgentSpec["category"], StaticImageData> = {
  "information-analysis": InformationGif,
  "creation-communication": CreationGif,
  "action-automation": ActionGif,
  "support-oversight": SupportGif,
  "planning-reasoning": PlanningGif,
};
/**
 * `motion="gif"` shows the first SVG frame until `playing`, then mounts the
 * animated GIF from `agent-icons/gif` so every hover restarts at frame one.
 * GIFs keep their original palette, so `accent` only applies to the SVG.
 */
export function AgentIcon({
  category,
  size = 80,
  paused = false,
  accent,
  motion = "svg",
  playing = false,
}: {
  category: AgentSpec["category"];
  size?: number;
  paused?: boolean;
  accent?: string;
  motion?: "svg" | "gif";
  playing?: boolean;
}) {
  const Icon = icons[category];
  const gif = motion === "gif";
  return (
    <span
      className="agent-icon"
      data-paused={paused}
      data-still={gif || undefined}
      style={
        {
          width: size,
          height: size,
          "--icon-accent": accent || "#3d6bff",
        } as CSSProperties
      }
    >
      {gif && playing ? (
        <img
          className="agent-icon-gif"
          src={gifs[category].src}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
        />
      ) : (
        <Icon aria-hidden="true" width={size} height={size} />
      )}
    </span>
  );
}
