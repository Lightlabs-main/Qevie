import React from "react";

interface LogoProps {
    size?: number;
    className?: string;
    glow?: boolean;
}

export default function Logo({ size = 64, className = "", glow = false }: LogoProps): React.ReactElement {
    return (
        <div
            className={`logo-container ${className}`}
            style={{
                width: size,
                height: size,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
            }}
        >
            {glow && (
                <div style={{
                    position: "absolute",
                    inset: "-15%",
                    background: "radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)",
                    filter: "blur(16px)",
                    zIndex: 0,
                    pointerEvents: "none",
                }} />
            )}
            <img
                src="/logo.png"
                alt="Qevie"
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    zIndex: 1,
                    position: "relative",
                }}
            />
        </div>
    );
}
