"""Start the existing stack on one explicit private LAN interface, preserving .env."""

import argparse
import ipaddress
import os
import socket
import subprocess
from pathlib import Path

from dotenv import dotenv_values

PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def lan_address(value: str) -> str:
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        raise argparse.ArgumentTypeError("Use a private LAN IPv4 address") from None
    if not any(address in network for network in PRIVATE_NETWORKS):
        raise argparse.ArgumentTypeError(
            "Use an RFC1918 LAN address, not loopback or public IP"
        )
    return str(address)


def start(address: str) -> None:
    root = Path(__file__).resolve().parents[1]
    if not (root / ".env").is_file():
        raise RuntimeError("Run scripts/init_env.py first")
    # Reject an address not assigned to this host before changing any containers.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((address, 0))
    environment = os.environ.copy()
    environment["LANDCONNECT_LAN_IP"] = address
    command = [
        "docker",
        "compose",
        "-f",
        str(root / "compose.yaml"),
        "-f",
        str(root / "compose.lan.yaml"),
    ]
    subprocess.run(
        command + ["config", "--quiet"], cwd=root, env=environment, check=True
    )
    subprocess.run(
        command + ["up", "--build", "--wait", "--wait-timeout", "120"],
        cwd=root,
        env=environment,
        check=True,
    )
    port = (
        os.getenv("API_PORT") or dotenv_values(root / ".env").get("API_PORT") or "8000"
    )
    print(f"API and Swagger: http://{address}:{port}/docs")
    print(f"LiveKit signaling: ws://{address}:7880")
    print("PostgreSQL and Redis remain bound to loopback. Existing .env was preserved.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, type=lan_address)
    args = parser.parse_args()
    try:
        start(args.host)
    except (OSError, RuntimeError, subprocess.CalledProcessError):
        parser.exit(
            1,
            "LAN startup failed. Check the local address, Docker and service health.\n",
        )


if __name__ == "__main__":
    main()
