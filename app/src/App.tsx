import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import BottomNav from "./components/BottomNav.js";
import { useWallet } from "./hooks/useWallet.js";

const Home = lazy(() => import("./pages/Home.js"));
const ControlCenter = lazy(() => import("./pages/ControlCenter.js"));
const AgentCommands = lazy(() => import("./pages/AgentCommands.js"));
const ManualRails = lazy(() => import("./pages/ManualRails.js"));
const Request = lazy(() => import("./pages/Request.js"));
const Send = lazy(() => import("./pages/Send.js"));
const PaymentLinks = lazy(() => import("./pages/PaymentLinks.js"));
const Scan = lazy(() => import("./pages/Scan.js"));
const Subscriptions = lazy(() => import("./pages/Subscriptions.js"));
const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const Profile = lazy(() => import("./pages/Profile.js"));
const History = lazy(() => import("./pages/History.js"));
const Passport = lazy(() => import("./pages/Passport.js"));
const ReceiptDetail = lazy(() => import("./pages/ReceiptDetail.js"));
const Developers = lazy(() => import("./pages/Developers.js"));
const Onboarding = lazy(() => import("./pages/Onboarding.js"));
const PayLink = lazy(() => import("./pages/PayLink.js"));
const BatchPay = lazy(() => import("./pages/BatchPay.js"));
const BulkImport = lazy(() => import("./pages/BulkImport.js"));
const Autopilot = lazy(() => import("./pages/Autopilot.js"));
const AutopilotNew = lazy(() => import("./pages/AutopilotNew.js"));
const AutopilotPolicies = lazy(() => import("./pages/AutopilotPolicies.js"));
const AutopilotActivity = lazy(() => import("./pages/AutopilotActivity.js"));

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
      <div className="app-container page-center">
        <Suspense fallback={<LoadingPage />}>
          <Routes>
            {/* Agent-native control center is the primary surface. */}
            <Route path="/" element={<ControlCenter />} />
            <Route path="/wallet" element={<Home />} />
            <Route path="/home" element={<Home />} />
            <Route path="/agent" element={<AgentCommands />} />
            <Route path="/agent/commands" element={<AgentCommands />} />
            <Route path="/rails" element={<ManualRails />} />
            <Route path="/request" element={<Request />} />
            <Route path="/send" element={<Send />} />
            <Route path="/links" element={<PaymentLinks />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/batch" element={<BatchPay />} />
            <Route path="/import" element={<BulkImport />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/history" element={<History />} />
            <Route path="/passport" element={<Passport />} />
            <Route path="/passport/:accountOrUsername" element={<Passport />} />
            <Route path="/receipt/:receiptId" element={<ReceiptDetail />} />
            <Route path="/developers" element={<Developers />} />
            <Route path="/autopilot" element={<Autopilot />} />
            <Route path="/autopilot/new" element={<AutopilotNew />} />
            <Route path="/autopilot/policies" element={<AutopilotPolicies />} />
            <Route path="/autopilot/activity" element={<AutopilotActivity />} />
            <Route path="/pay" element={<PayLink />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <BottomNav />
    </>
  );
}
