DELETE FROM auth_devices legacy_device
USING auth_devices persistent_device
WHERE legacy_device.user_id = persistent_device.user_id
  AND legacy_device.id <> persistent_device.id
  AND legacy_device.device_key LIKE 'legacy-session:%'
  AND persistent_device.device_key NOT LIKE 'legacy-session:%'
  AND legacy_device.user_agent IS NOT DISTINCT FROM persistent_device.user_agent;
