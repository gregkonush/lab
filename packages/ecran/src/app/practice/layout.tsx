export default function PracticeLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[calc(100vh-10rem)] flex flex-col justify-center items-center">{children}</div>
}