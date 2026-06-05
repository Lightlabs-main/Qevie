import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import BottomNav from "./components/BottomNav.js";
import { useWallet } from "./hooks/useWallet.js";

const Home = lazy(() => import("./pages/Home.js"));
const Send = lazy(() => import("./pages/Send.js"));
const PaymentLinks = lazy(() => import("./pages/PaymentLinks.js"));
const Scan = lazy(() => import("./pages/Scan.js"));
const Subscriptions = lazy(() => import("./pages/Subscriptions.js"));
const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const Profile = lazy(() => import("./pages/Profile.js"));
const Onboarding = lazy(() => import("./pages/Onboarding.js"));
const PayLink = lazy(() => import("./pages/PayLink.js"));
const BatchPay = lazy(() => import("./pages/BatchPay.js"));

function LoadingPage(): React.ReactElement {
  return (
    <div className="flex-center" style={{ minHeight: "60vh" }}>
      <span className="spinner spinner-lg" />
    </div>
  );
}

export default function App(): React.ReactElement {
  const { address } = useWallet();

  if (address === null) {
    return (
      <Suspense fallback={<LoadingPage />}>
        <Routes>
          <Route path="/onboard" element={<Onboarding />} />
          <Route path="/pay" element={<PayLink />} />
          <Route path="*" element={<Navigate to="/onboard" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <Suspense fallback={<LoadingPage />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/send" element={<Send />} />
          <Route path="/links" element={<PaymentLinks />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/batch" element={<BatchPay />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/pay" element={<PayLink />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <BottomNav />
    </>
  );
}
