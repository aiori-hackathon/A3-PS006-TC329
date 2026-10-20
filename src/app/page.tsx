"use client";

import { useState } from "react";
import { Fascia, type SectionKey } from "@/components/lab/header";
import { InvariantsBar } from "@/components/lab/footer";
import { ConsoleSection } from "@/components/sections/console-section";
import { ScenariosSection } from "@/components/sections/scenarios-section";
import { PolicySection } from "@/components/sections/policy-section";
import { RecordsSection } from "@/components/sections/records-section";
import { useLabSocket } from "@/hooks/use-lab-socket";

function Console() {
  useLabSocket();
  const [section, setSection] = useState<SectionKey>("console");

  return (
    <div className="flex min-h-screen flex-col">
      <Fascia section={section} onSection={setSection} />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6">
        {section === "console" && <ConsoleSection />}
        {section === "scenarios" && <ScenariosSection />}
        {section === "policy" && <PolicySection />}
        {section === "records" && <RecordsSection />}
      </main>
      <InvariantsBar />
    </div>
  );
}

export default function Home() {
  return <Console />;
}
