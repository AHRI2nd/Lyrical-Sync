#!/usr/bin/env python3
"""Validate a decoded Mac App Store profile and derive signing entitlements."""
import argparse
import datetime
import json
import hashlib
import re
import plistlib


def validate(profile, bundle_id, template):
    expiration = profile.get("ExpirationDate")
    now = datetime.datetime.now(datetime.timezone.utc)
    if not isinstance(expiration, datetime.datetime) or expiration.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError("Provisioning profile is expired or has no expiration date")
    entitlements = profile.get("Entitlements", {})
    team = entitlements.get("com.apple.developer.team-identifier")
    if not team or team not in profile.get("TeamIdentifier", []):
        raise ValueError("Provisioning profile team identifiers disagree")
    expected = f"{team}.{bundle_id}"
    if entitlements.get("com.apple.application-identifier") != expected:
        raise ValueError("Provisioning profile application identifier does not match the bundle ID")
    if entitlements.get("get-task-allow") or entitlements.get("com.apple.security.get-task-allow"):
        raise ValueError("Development provisioning profiles cannot be submitted to the Store")
    if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
        raise ValueError("Use a Mac App Store distribution profile, not development or direct distribution")
    result = dict(template)
    result["com.apple.application-identifier"] = expected
    result["com.apple.developer.team-identifier"] = team
    for key in ("com.apple.security.app-sandbox", "com.apple.security.network.client", "com.apple.security.files.user-selected.read-write", "com.apple.security.files.bookmarks.app-scope"):
        if result.get(key) is not True:
            raise ValueError(f"Required Store entitlement missing: {key}")
        if key in entitlements and entitlements[key] is not True:
            raise ValueError(f"Profile forbids required entitlement: {key}")
    return result, team


def signing_identities(profile, text, selected_application, selected_installer, team):
    rows = re.findall(r'[0-9]+\) ([A-Fa-f0-9]{40}) "([^\"]+)"', text)
    app_pattern = r"^(Apple Distribution:|3rd Party Mac Developer Application:|Mac App Distribution:)"
    installer_pattern = r"^(3rd Party Mac Developer Installer:|Mac Installer Distribution:)"

    def select(requested, pattern, kind):
        if requested:
            matches = [(fingerprint.upper(), name) for fingerprint, name in rows
                       if requested == name or requested.upper() == fingerprint.upper()]
        else:
            matches = [(fingerprint.upper(), name) for fingerprint, name in rows if re.match(pattern, name)]
        if len(matches) != 1:
            raise ValueError(f"Select exactly one valid {kind} certificate from the keychain")
        fingerprint, name = matches[0]
        if not re.match(pattern, name):
            raise ValueError(f"Selected {kind} certificate is not an App Store distribution certificate")
        if not name.endswith(f"({team})"):
            raise ValueError(f"Selected {kind} certificate does not match the profile team")
        return fingerprint

    application = select(selected_application, app_pattern, "application distribution")
    installer = select(selected_installer, installer_pattern, "installer distribution")
    allowed = {hashlib.sha1(der).hexdigest().upper() for der in profile.get("DeveloperCertificates", [])}
    if application not in allowed:
        raise ValueError("Selected application certificate is not authorized by the provisioning profile")
    return application, installer


def main():
    parser = argparse.ArgumentParser()
    for name in ("profile", "bundle-id", "template", "output", "identities"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--signing-identity", default="")
    parser.add_argument("--installer-identity", default="")
    args = parser.parse_args()
    try:
        with open(args.profile, "rb") as handle:
            profile = plistlib.load(handle)
        with open(args.template, "rb") as handle:
            template = plistlib.load(handle)
        entitlements, team = validate(profile, args.bundle_id, template)
        with open(args.identities) as handle:
            signing, installer = signing_identities(profile, handle.read(), args.signing_identity, args.installer_identity, team)
        with open(args.output, "wb") as handle:
            plistlib.dump(entitlements, handle)
        print(json.dumps({"team": team, "bundleId": args.bundle_id, "expiration": profile["ExpirationDate"].isoformat(), "signingIdentity": signing, "installerIdentity": installer}))
    except (ValueError, OSError, plistlib.InvalidFileException) as error:
        parser.exit(1, f"App Store profile validation failed: {error}\n")


if __name__ == "__main__":
    main()
