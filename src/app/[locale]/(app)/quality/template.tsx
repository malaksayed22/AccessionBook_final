import { PageTemplate } from "@/components/shell/PageTemplate";

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTemplate>{children}</PageTemplate>;
}
