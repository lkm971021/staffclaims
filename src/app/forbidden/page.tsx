import Link from "next/link";
export default function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">Not available</h1>
        <p className="mt-2 text-gray-500">You do not have access to this page.</p>
        <Link href="/" className="btn-primary mt-4">Go to my home page</Link>
      </div>
    </div>
  );
}
