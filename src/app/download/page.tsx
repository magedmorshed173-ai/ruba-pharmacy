import type { Metadata } from "next";
import DownloadClient from "./download-client";

export const metadata: Metadata = {
  title: "تحميل التطبيق · ربي فارمسي",
  description:
    "حمّل صيدلية رُبى على كل أجهزتك: أندرويد، آيفون، ويندوز، ماك، لينكس، وTermux — تطبيق ويب متقدم PWA يُثبَّت بضغطة، أو خادم ذاتي الاستضافة بأمر واحد.",
};

export default function DownloadPage() {
  return <DownloadClient />;
}
