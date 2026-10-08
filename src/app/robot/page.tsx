import type { Metadata } from "next";
import { RobotGame } from "./RobotGame";

export const metadata: Metadata = { title: "Play with a robot — Safe Chess" };

export default function Page() {
  return <RobotGame />;
}
