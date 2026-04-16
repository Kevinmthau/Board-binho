namespace BoardBinho
{
    using System.Collections.Generic;

    using Board.Core;
    using Board.Input;

    using UnityEngine;
    using UnityEngine.InputSystem;

    [DisallowMultipleComponent]
    public sealed class BinhoGameController : MonoBehaviour
    {
        private const float kFieldWidth = 16f;
        private const float kFieldHeight = 9f;
        private const float kFieldLineInset = 0.18f;
        private const float kWallThickness = 0.22f;
        private const float kGoalDepth = 0.9f;
        private const float kGoalHalfHeight = 0.95f;
        private const float kGoalBoxDepth = 1.2f;
        private const float kGoalBoxHalfHeight = 0.95f;
        private const float kPenaltyBoxDepth = 2.6f;
        private const float kPenaltyBoxHalfHeight = 1.9f;
        private const float kCenterCircleRadius = 1.3f;
        private const float kPenaltyArcRadius = 0.85f;
        private const float kDefenderRadius = 0.32f;
        private const float kSlotSnapRadius = 0.95f;
        private const float kBallRadius = 0.2f;
        private const float kBallDragActivationRadius = 0.5f;
        private const float kMinShotDragDistance = 0.15f;
        private const float kMaxShotDragDistance = 1.7f;
        private const float kShotImpulseScale = 8.5f;
        private const float kBallRestVelocity = 0.11f;
        private const float kBallRestTime = 0.35f;
        private const float kGoalPauseDuration = 1.15f;

        private static readonly Color kFieldColor = new Color(0.09f, 0.35f, 0.18f);
        private static readonly Color kFieldInnerTint = new Color(0.13f, 0.42f, 0.23f);
        private static readonly Color kRailColor = new Color(0.83f, 0.83f, 0.83f);
        private static readonly Color kLineColor = new Color(0.96f, 0.96f, 0.94f);
        private static readonly Color kLeftColor = new Color(0.22f, 0.73f, 0.98f);
        private static readonly Color kRightColor = new Color(0.98f, 0.66f, 0.18f);
        private static readonly Color kBallColor = new Color(0.98f, 0.98f, 0.98f);
        private static readonly Color kShadowColor = new Color(0f, 0f, 0f, 0.18f);

        [SerializeField] private Camera m_WorldCamera;
        [SerializeField] private bool m_EnableMouseFallback = true;

        private readonly List<DefenderSlot> m_LeftSlots = new List<DefenderSlot>();
        private readonly List<DefenderSlot> m_RightSlots = new List<DefenderSlot>();
        private readonly List<DefenderSlot> m_AllSlots = new List<DefenderSlot>();

        private Material m_SpriteMaterial;
        private Sprite m_SquareSprite;
        private Sprite m_CircleSprite;
        private PhysicsMaterial2D m_BouncyMaterial;

        private Rigidbody2D m_BallBody;
        private SpriteRenderer m_BallRenderer;
        private LineRenderer m_AimLine;

        private MatchPhase m_Phase = MatchPhase.Setup;
        private PlayerSide m_CurrentTurn = PlayerSide.Left;
        private PlayerSide m_LastScoringSide = PlayerSide.Left;
        private int m_LeftScore;
        private int m_RightScore;
        private int m_ActiveBoardContactId = -1;
        private bool m_MouseShotActive;
        private bool m_HandledBoardShotThisFrame;
        private float m_BallStillTimer;
        private float m_GoalPauseTimer;
        private bool m_DidServeInitialKickoff;
        private Vector2 m_CurrentAimWorld;

        private float FieldHalfWidth => kFieldWidth * 0.5f;
        private float FieldHalfHeight => kFieldHeight * 0.5f;

        private void Awake()
        {
            Application.targetFrameRate = 60;
            BoardApplication.UpdatePauseScreenContext(applicationName: "Board Binho");

            if (m_WorldCamera == null)
            {
                m_WorldCamera = Camera.main;
            }

            if (m_WorldCamera == null)
            {
                m_WorldCamera = FindAnyObjectByType<Camera>();
            }

            EnsureRuntimeResources();
            BuildPlayfield();
            ResetBallToCenter();
        }

        private void Update()
        {
            m_HandledBoardShotThisFrame = false;

            UpdateDefenderPlacements();
            UpdateMatchPhaseFromPlacements();
            UpdateShotInput();
            UpdateAimLine();

            if (m_Phase == MatchPhase.GoalPause)
            {
                m_GoalPauseTimer += Time.deltaTime;
                if (m_GoalPauseTimer >= kGoalPauseDuration)
                {
                    m_GoalPauseTimer = 0f;
                    ResetBallToCenter();
                    m_CurrentTurn = m_LastScoringSide == PlayerSide.Left ? PlayerSide.Right : PlayerSide.Left;
                    m_Phase = AllSlotsOccupied() ? MatchPhase.ReadyToShoot : MatchPhase.Setup;
                }
            }
        }

        private void FixedUpdate()
        {
            if (m_Phase == MatchPhase.GoalPause)
            {
                return;
            }

            CheckForGoal();
            UpdateBallMotionState();
        }

        private void OnGUI()
        {
            var headerStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = Mathf.RoundToInt(Screen.height * 0.032f),
                fontStyle = FontStyle.Bold,
                normal = { textColor = Color.white },
            };

            var bodyStyle = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                fontSize = Mathf.RoundToInt(Screen.height * 0.022f),
                wordWrap = true,
                normal = { textColor = new Color(1f, 1f, 1f, 0.92f) },
            };

            var scoreText = $"Blue {m_LeftScore}  -  {m_RightScore} Orange";
            GUI.Label(new Rect(0f, 18f, Screen.width, 36f), scoreText, headerStyle);

            GUI.Label(new Rect(0f, 58f, Screen.width, 30f), GetStatusMessage(), bodyStyle);

            var placementText = $"Blue defenders: {CountOccupied(m_LeftSlots)}/5    Orange defenders: {CountOccupied(m_RightSlots)}/5";
            GUI.Label(new Rect(0f, Screen.height - 46f, Screen.width, 24f), placementText, bodyStyle);
        }

        private void EnsureRuntimeResources()
        {
            if (m_SpriteMaterial == null)
            {
                m_SpriteMaterial = new Material(Shader.Find("Sprites/Default"));
            }

            if (m_SquareSprite == null)
            {
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false)
                {
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                texture.SetPixels(new[] { Color.white, Color.white, Color.white, Color.white });
                texture.Apply();
                m_SquareSprite = Sprite.Create(texture, new Rect(0f, 0f, texture.width, texture.height), new Vector2(0.5f, 0.5f), 2f);
            }

            if (m_CircleSprite == null)
            {
                const int size = 64;
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
                {
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };

                var pixels = new Color[size * size];
                var radius = (size - 2f) * 0.5f;
                var center = new Vector2((size - 1f) * 0.5f, (size - 1f) * 0.5f);

                for (var y = 0; y < size; y++)
                {
                    for (var x = 0; x < size; x++)
                    {
                        var distance = Vector2.Distance(new Vector2(x, y), center);
                        var alpha = Mathf.Clamp01(radius - distance);
                        pixels[(y * size) + x] = new Color(1f, 1f, 1f, alpha);
                    }
                }

                texture.SetPixels(pixels);
                texture.Apply();
                m_CircleSprite = Sprite.Create(texture, new Rect(0f, 0f, size, size), new Vector2(0.5f, 0.5f), size);
            }

            if (m_BouncyMaterial == null)
            {
                m_BouncyMaterial = new PhysicsMaterial2D("BinhoBounce")
                {
                    friction = 0.05f,
                    bounciness = 0.94f,
                };
            }
        }

        private void BuildPlayfield()
        {
            var fieldRoot = new GameObject("Binho Field");
            fieldRoot.transform.SetParent(transform, false);

            CreateQuad(fieldRoot.transform, "Outer Rail", Vector2.zero, new Vector2(kFieldWidth + 0.7f, kFieldHeight + 0.7f), kRailColor, -0.15f, -5);
            CreateQuad(fieldRoot.transform, "Field Surface", Vector2.zero, new Vector2(kFieldWidth, kFieldHeight), kFieldColor, -0.1f, -4);
            CreateQuad(fieldRoot.transform, "Field Inner", Vector2.zero, new Vector2(kFieldWidth - 0.4f, kFieldHeight - 0.4f), kFieldInnerTint, -0.09f, -3);

            BuildWalls(fieldRoot.transform);
            BuildFieldLines(fieldRoot.transform);
            BuildSlots(fieldRoot.transform);
            BuildBall(fieldRoot.transform);

            if (m_WorldCamera != null)
            {
                m_WorldCamera.orthographic = true;
                m_WorldCamera.orthographicSize = 5.5f;
                m_WorldCamera.transform.position = new Vector3(0f, 0f, -10f);
                m_WorldCamera.backgroundColor = new Color(0.05f, 0.08f, 0.06f);
            }
        }

        private void BuildWalls(Transform parent)
        {
            var upperWallHeight = FieldHalfHeight - kGoalHalfHeight;
            var upperWallCenterY = kGoalHalfHeight + (upperWallHeight * 0.5f);
            var goalBackX = FieldHalfWidth + kGoalDepth + (kWallThickness * 0.5f);
            var goalInteriorX = FieldHalfWidth + (kGoalDepth * 0.5f);

            CreateWall(parent, "Top Wall", new Vector2(0f, FieldHalfHeight + (kWallThickness * 0.5f)), new Vector2(kFieldWidth, kWallThickness));
            CreateWall(parent, "Bottom Wall", new Vector2(0f, -FieldHalfHeight - (kWallThickness * 0.5f)), new Vector2(kFieldWidth, kWallThickness));

            CreateWall(parent, "Left Upper Wall", new Vector2(-FieldHalfWidth - (kWallThickness * 0.5f), upperWallCenterY), new Vector2(kWallThickness, upperWallHeight));
            CreateWall(parent, "Left Lower Wall", new Vector2(-FieldHalfWidth - (kWallThickness * 0.5f), -upperWallCenterY), new Vector2(kWallThickness, upperWallHeight));
            CreateWall(parent, "Right Upper Wall", new Vector2(FieldHalfWidth + (kWallThickness * 0.5f), upperWallCenterY), new Vector2(kWallThickness, upperWallHeight));
            CreateWall(parent, "Right Lower Wall", new Vector2(FieldHalfWidth + (kWallThickness * 0.5f), -upperWallCenterY), new Vector2(kWallThickness, upperWallHeight));

            CreateWall(parent, "Left Goal Back", new Vector2(-goalBackX, 0f), new Vector2(kWallThickness, kGoalHalfHeight * 2f));
            CreateWall(parent, "Right Goal Back", new Vector2(goalBackX, 0f), new Vector2(kWallThickness, kGoalHalfHeight * 2f));
            CreateWall(parent, "Left Goal Roof", new Vector2(-goalInteriorX, kGoalHalfHeight + (kWallThickness * 0.5f)), new Vector2(kGoalDepth, kWallThickness));
            CreateWall(parent, "Left Goal Floor", new Vector2(-goalInteriorX, -kGoalHalfHeight - (kWallThickness * 0.5f)), new Vector2(kGoalDepth, kWallThickness));
            CreateWall(parent, "Right Goal Roof", new Vector2(goalInteriorX, kGoalHalfHeight + (kWallThickness * 0.5f)), new Vector2(kGoalDepth, kWallThickness));
            CreateWall(parent, "Right Goal Floor", new Vector2(goalInteriorX, -kGoalHalfHeight - (kWallThickness * 0.5f)), new Vector2(kGoalDepth, kWallThickness));
        }

        private void BuildFieldLines(Transform parent)
        {
            var lineRoot = new GameObject("Field Lines");
            lineRoot.transform.SetParent(parent, false);

            CreateRectangleLine(lineRoot.transform, "Boundary", new Vector2(kFieldWidth - (kFieldLineInset * 2f), kFieldHeight - (kFieldLineInset * 2f)), kLineColor, 0.07f);
            CreateLine(lineRoot.transform, "Halfway", kLineColor, 0.06f, new[]
            {
                new Vector3(0f, -FieldHalfHeight + kFieldLineInset, 0f),
                new Vector3(0f, FieldHalfHeight - kFieldLineInset, 0f),
            });

            CreateCircleLine(lineRoot.transform, "Center Circle", Vector2.zero, kCenterCircleRadius, kLineColor, 0.06f, 48, 0f, 360f);
            CreateDisc(parent, "Center Spot", Vector2.zero, 0.09f, kLineColor, 4);

            BuildGoalSideLines(lineRoot.transform, false);
            BuildGoalSideLines(lineRoot.transform, true);
        }

        private void BuildGoalSideLines(Transform parent, bool isRightSide)
        {
            var direction = isRightSide ? 1f : -1f;
            var sideName = isRightSide ? "Right" : "Left";
            var fieldX = direction * (FieldHalfWidth - kFieldLineInset);
            var goalBoxFrontX = fieldX - (direction * kGoalBoxDepth);
            var penaltyBoxFrontX = fieldX - (direction * kPenaltyBoxDepth);
            var penaltyMarkX = fieldX - (direction * 1.95f);
            var goalNetBackX = fieldX + (direction * 0.75f);

            CreateRectangleLine(
                parent,
                sideName + " Goal Box",
                new Vector2(Mathf.Abs(goalBoxFrontX - fieldX), kGoalBoxHalfHeight * 2f),
                kLineColor,
                0.06f,
                new Vector2((goalBoxFrontX + fieldX) * 0.5f, 0f));

            CreateRectangleLine(
                parent,
                sideName + " Penalty Box",
                new Vector2(Mathf.Abs(penaltyBoxFrontX - fieldX), kPenaltyBoxHalfHeight * 2f),
                kLineColor,
                0.06f,
                new Vector2((penaltyBoxFrontX + fieldX) * 0.5f, 0f));

            CreateRectangleLine(
                parent,
                sideName + " Goal Net",
                new Vector2(Mathf.Abs(goalNetBackX - fieldX), kGoalHalfHeight * 2f),
                new Color(1f, 1f, 1f, 0.6f),
                0.045f,
                new Vector2((goalNetBackX + fieldX) * 0.5f, 0f));

            CreateDisc(parent.parent, sideName + " Penalty Spot", new Vector2(penaltyMarkX, 0f), 0.08f, kLineColor, 4);

            if (isRightSide)
            {
                CreateCircleLine(parent, sideName + " Penalty Arc", new Vector2(penaltyMarkX, 0f), kPenaltyArcRadius, kLineColor, 0.05f, 20, 125f, 235f);
            }
            else
            {
                CreateCircleLine(parent, sideName + " Penalty Arc", new Vector2(penaltyMarkX, 0f), kPenaltyArcRadius, kLineColor, 0.05f, 20, -55f, 55f);
            }
        }

        private void BuildSlots(Transform parent)
        {
            var slotRoot = new GameObject("Defender Slots");
            slotRoot.transform.SetParent(parent, false);

            var leftSlotPositions = new[]
            {
                new Vector2(-6.75f, 0.95f),
                new Vector2(-6.75f, -0.95f),
                new Vector2(-5.95f, 0f),
                new Vector2(-4.95f, 1.45f),
                new Vector2(-4.95f, -1.45f),
            };

            for (var i = 0; i < leftSlotPositions.Length; i++)
            {
                CreateSlot(slotRoot.transform, PlayerSide.Left, $"Left Slot {i + 1}", leftSlotPositions[i]);
                CreateSlot(slotRoot.transform, PlayerSide.Right, $"Right Slot {i + 1}", new Vector2(-leftSlotPositions[i].x, leftSlotPositions[i].y));
            }
        }

        private void BuildBall(Transform parent)
        {
            var ballShadow = CreateDisc(parent, "Ball Shadow", new Vector2(0.05f, -0.07f), kBallRadius * 2.25f, kShadowColor, 7);
            ballShadow.transform.localScale = new Vector3(1.15f, 0.7f, 1f);

            var ball = new GameObject("Ball");
            ball.transform.SetParent(parent, false);
            ball.transform.localPosition = new Vector3(0f, 0f, 0f);

            m_BallRenderer = ball.AddComponent<SpriteRenderer>();
            m_BallRenderer.sprite = m_CircleSprite;
            m_BallRenderer.color = kBallColor;
            m_BallRenderer.sortingOrder = 8;
            ball.transform.localScale = Vector3.one * (kBallRadius * 2f);

            var ballCollider = ball.AddComponent<CircleCollider2D>();
            ballCollider.radius = 0.5f;
            ballCollider.sharedMaterial = m_BouncyMaterial;

            m_BallBody = ball.AddComponent<Rigidbody2D>();
            m_BallBody.gravityScale = 0f;
            m_BallBody.mass = 0.9f;
            m_BallBody.linearDamping = 0.85f;
            m_BallBody.angularDamping = 1.5f;
            m_BallBody.interpolation = RigidbodyInterpolation2D.Interpolate;
            m_BallBody.collisionDetectionMode = CollisionDetectionMode2D.Continuous;
            m_BallBody.sharedMaterial = m_BouncyMaterial;

            var trail = ball.AddComponent<TrailRenderer>();
            trail.material = m_SpriteMaterial;
            trail.time = 0.28f;
            trail.startColor = new Color(1f, 1f, 1f, 0.35f);
            trail.endColor = new Color(1f, 1f, 1f, 0f);
            trail.startWidth = 0.16f;
            trail.endWidth = 0.04f;
            trail.sortingOrder = 7;

            var aim = new GameObject("Aim Line");
            aim.transform.SetParent(parent, false);
            m_AimLine = aim.AddComponent<LineRenderer>();
            m_AimLine.material = m_SpriteMaterial;
            m_AimLine.positionCount = 2;
            m_AimLine.startWidth = 0.07f;
            m_AimLine.endWidth = 0.02f;
            m_AimLine.startColor = new Color(1f, 1f, 1f, 0.95f);
            m_AimLine.endColor = new Color(1f, 1f, 1f, 0.05f);
            m_AimLine.sortingOrder = 9;
            m_AimLine.enabled = false;
            m_AimLine.numCapVertices = 4;
            m_AimLine.useWorldSpace = true;
        }

        private void CreateSlot(Transform parent, PlayerSide side, string slotName, Vector2 position)
        {
            var slotRoot = new GameObject(slotName);
            slotRoot.transform.SetParent(parent, false);
            slotRoot.transform.localPosition = new Vector3(position.x, position.y, 0f);

            var fill = CreateDisc(slotRoot.transform, "Slot Fill", Vector2.zero, kDefenderRadius * 2.45f, side == PlayerSide.Left ? new Color(kLeftColor.r, kLeftColor.g, kLeftColor.b, 0.16f) : new Color(kRightColor.r, kRightColor.g, kRightColor.b, 0.16f), 2);
            var outline = CreateCircleLine(slotRoot.transform, "Slot Outline", Vector2.zero, kDefenderRadius * 1.25f, kLineColor, 0.05f, 28, 0f, 360f);

            var defender = new GameObject("Defender");
            defender.transform.SetParent(slotRoot.transform, false);
            defender.transform.localScale = Vector3.one * (kDefenderRadius * 2f);

            var shadow = CreateDisc(defender.transform, "Shadow", new Vector2(0.05f, -0.07f), 1.22f, kShadowColor, 3);
            shadow.transform.localScale = new Vector3(1.1f, 0.72f, 1f);

            var defenderRenderer = defender.AddComponent<SpriteRenderer>();
            defenderRenderer.sprite = m_CircleSprite;
            defenderRenderer.color = side == PlayerSide.Left ? new Color(kLeftColor.r, kLeftColor.g, kLeftColor.b, 0.95f) : new Color(kRightColor.r, kRightColor.g, kRightColor.b, 0.95f);
            defenderRenderer.sortingOrder = 5;

            var bumper = new GameObject("Bumper Core");
            bumper.transform.SetParent(defender.transform, false);
            bumper.transform.localScale = Vector3.one * 0.55f;
            var bumperRenderer = bumper.AddComponent<SpriteRenderer>();
            bumperRenderer.sprite = m_CircleSprite;
            bumperRenderer.color = new Color(1f, 1f, 1f, 0.9f);
            bumperRenderer.sortingOrder = 6;

            var collider = defender.AddComponent<CircleCollider2D>();
            collider.radius = 0.5f;
            collider.sharedMaterial = m_BouncyMaterial;

            var slot = new DefenderSlot
            {
                Side = side,
                Position = position,
                SlotFill = fill,
                SlotOutline = outline,
                DefenderRoot = defender,
                DefenderRenderer = defenderRenderer,
                DefenderCollider = collider,
            };

            slot.SetOccupied(false);

            if (side == PlayerSide.Left)
            {
                m_LeftSlots.Add(slot);
            }
            else
            {
                m_RightSlots.Add(slot);
            }

            m_AllSlots.Add(slot);
        }

        private void UpdateDefenderPlacements()
        {
            var glyphs = BoardInput.GetActiveContacts(BoardContactType.Glyph);
            var activeGlyphs = new List<ContactWorldState>(glyphs.Length);

            for (var i = 0; i < glyphs.Length; i++)
            {
                activeGlyphs.Add(new ContactWorldState
                {
                    ContactId = glyphs[i].contactId,
                    WorldPosition = ScreenToWorld(glyphs[i].screenPosition),
                });
            }

            for (var i = 0; i < m_AllSlots.Count; i++)
            {
                m_AllSlots[i].ContactId = -1;
            }

            AssignSlots(m_LeftSlots, activeGlyphs, false);
            AssignSlots(m_RightSlots, activeGlyphs, true);

            for (var i = 0; i < m_AllSlots.Count; i++)
            {
                m_AllSlots[i].SetOccupied(m_AllSlots[i].ContactId >= 0);
            }
        }

        private void AssignSlots(List<DefenderSlot> slots, List<ContactWorldState> contacts, bool rightSide)
        {
            var claimedContactIds = new HashSet<int>();
            for (var i = 0; i < slots.Count; i++)
            {
                var slot = slots[i];
                var bestDistance = float.MaxValue;
                var bestContactId = -1;

                for (var j = 0; j < contacts.Count; j++)
                {
                    var candidate = contacts[j];
                    if (claimedContactIds.Contains(candidate.ContactId))
                    {
                        continue;
                    }

                    if (rightSide && candidate.WorldPosition.x < 0f)
                    {
                        continue;
                    }

                    if (!rightSide && candidate.WorldPosition.x > 0f)
                    {
                        continue;
                    }

                    var distance = Vector2.Distance(slot.Position, candidate.WorldPosition);
                    if (distance > kSlotSnapRadius || distance >= bestDistance)
                    {
                        continue;
                    }

                    bestDistance = distance;
                    bestContactId = candidate.ContactId;
                }

                slot.ContactId = bestContactId;
                if (bestContactId >= 0)
                {
                    claimedContactIds.Add(bestContactId);
                }
            }
        }

        private void UpdateMatchPhaseFromPlacements()
        {
            if (!AllSlotsOccupied())
            {
                CancelActiveShot();
                StopBall();
                if (m_Phase != MatchPhase.GoalPause)
                {
                    m_Phase = MatchPhase.Setup;
                }
                return;
            }

            if (!m_DidServeInitialKickoff)
            {
                m_DidServeInitialKickoff = true;
                ResetBallToCenter();
                m_CurrentTurn = PlayerSide.Left;
            }

            if (m_Phase == MatchPhase.Setup)
            {
                m_Phase = MatchPhase.ReadyToShoot;
            }
        }

        private void UpdateShotInput()
        {
            if (m_Phase == MatchPhase.Setup || m_Phase == MatchPhase.GoalPause)
            {
                return;
            }

            HandleBoardFingerShotInput();

            if (m_EnableMouseFallback && !m_HandledBoardShotThisFrame)
            {
                HandleMouseShotInput();
            }
        }

        private void HandleBoardFingerShotInput()
        {
            var fingers = BoardInput.GetActiveContacts(BoardContactType.Finger);
            var activeContactSeen = false;

            for (var i = 0; i < fingers.Length; i++)
            {
                var contact = fingers[i];
                var worldPosition = ScreenToWorld(contact.screenPosition);

                if (m_ActiveBoardContactId == contact.contactId)
                {
                    activeContactSeen = true;
                    m_HandledBoardShotThisFrame = true;
                    m_CurrentAimWorld = worldPosition;
                    continue;
                }

                if (m_ActiveBoardContactId >= 0 || !CanStartShotAt(worldPosition))
                {
                    continue;
                }

                if (contact.phase == BoardContactPhase.Began)
                {
                    m_ActiveBoardContactId = contact.contactId;
                    m_CurrentAimWorld = worldPosition;
                    m_Phase = MatchPhase.Aiming;
                    activeContactSeen = true;
                    m_HandledBoardShotThisFrame = true;
                }
            }

            if (m_ActiveBoardContactId >= 0 && !activeContactSeen)
            {
                ReleaseShot(m_CurrentAimWorld);
                m_ActiveBoardContactId = -1;
            }
        }

        private void HandleMouseShotInput()
        {
            var mouse = Mouse.current;
            if (mouse == null)
            {
                return;
            }

            var worldPosition = ScreenToWorld(mouse.position.ReadValue(), false);

            if (!m_MouseShotActive && mouse.leftButton.wasPressedThisFrame && CanStartShotAt(worldPosition))
            {
                m_MouseShotActive = true;
                m_CurrentAimWorld = worldPosition;
                m_Phase = MatchPhase.Aiming;
            }
            else if (m_MouseShotActive && mouse.leftButton.isPressed)
            {
                m_CurrentAimWorld = worldPosition;
            }
            else if (m_MouseShotActive && mouse.leftButton.wasReleasedThisFrame)
            {
                ReleaseShot(worldPosition);
                m_MouseShotActive = false;
            }
        }

        private bool CanStartShotAt(Vector2 pointerWorldPosition)
        {
            if (m_Phase != MatchPhase.ReadyToShoot && m_Phase != MatchPhase.Aiming)
            {
                return false;
            }

            if (!AllSlotsOccupied())
            {
                return false;
            }

            if (m_BallBody == null || m_BallBody.linearVelocity.sqrMagnitude > kBallRestVelocity * kBallRestVelocity)
            {
                return false;
            }

            return Vector2.Distance(pointerWorldPosition, m_BallBody.position) <= kBallDragActivationRadius;
        }

        private void ReleaseShot(Vector2 worldPosition)
        {
            if (m_BallBody == null)
            {
                return;
            }

            var pullVector = m_BallBody.position - worldPosition;
            var distance = pullVector.magnitude;

            CancelActiveShot();

            if (distance < kMinShotDragDistance)
            {
                m_Phase = MatchPhase.ReadyToShoot;
                return;
            }

            var impulse = Vector2.ClampMagnitude(pullVector, kMaxShotDragDistance) * kShotImpulseScale;
            m_BallBody.linearVelocity = Vector2.zero;
            m_BallBody.angularVelocity = 0f;
            m_BallBody.AddForce(impulse, ForceMode2D.Impulse);
            m_Phase = MatchPhase.BallInMotion;
            m_BallStillTimer = 0f;
        }

        private void CancelActiveShot()
        {
            m_ActiveBoardContactId = -1;
            m_MouseShotActive = false;
            if (m_AimLine != null)
            {
                m_AimLine.enabled = false;
            }
        }

        private void UpdateAimLine()
        {
            if (m_AimLine == null || m_BallBody == null)
            {
                return;
            }

            var isAiming = m_ActiveBoardContactId >= 0 || m_MouseShotActive;
            m_AimLine.enabled = isAiming;
            if (!isAiming)
            {
                return;
            }

            m_AimLine.SetPosition(0, m_BallBody.position);
            m_AimLine.SetPosition(1, Vector2.Lerp(m_BallBody.position, m_CurrentAimWorld, 0.92f));
        }

        private void UpdateBallMotionState()
        {
            if (m_BallBody == null || m_Phase == MatchPhase.Setup || m_Phase == MatchPhase.Aiming)
            {
                return;
            }

            if (m_BallBody.linearVelocity.magnitude <= kBallRestVelocity)
            {
                m_BallStillTimer += Time.fixedDeltaTime;
            }
            else
            {
                m_BallStillTimer = 0f;
            }

            if (m_Phase == MatchPhase.BallInMotion && m_BallStillTimer >= kBallRestTime)
            {
                StopBall();
                m_CurrentTurn = m_CurrentTurn == PlayerSide.Left ? PlayerSide.Right : PlayerSide.Left;
                m_Phase = MatchPhase.ReadyToShoot;
            }
        }

        private void CheckForGoal()
        {
            if (m_BallBody == null || m_Phase == MatchPhase.GoalPause)
            {
                return;
            }

            var position = m_BallBody.position;
            if (Mathf.Abs(position.y) > kGoalHalfHeight - 0.05f)
            {
                return;
            }

            if (position.x <= -FieldHalfWidth - 0.16f)
            {
                RegisterGoal(PlayerSide.Right);
            }
            else if (position.x >= FieldHalfWidth + 0.16f)
            {
                RegisterGoal(PlayerSide.Left);
            }
        }

        private void RegisterGoal(PlayerSide scorer)
        {
            StopBall();
            CancelActiveShot();

            m_LastScoringSide = scorer;
            if (scorer == PlayerSide.Left)
            {
                m_LeftScore++;
            }
            else
            {
                m_RightScore++;
            }

            m_Phase = MatchPhase.GoalPause;
            m_GoalPauseTimer = 0f;
        }

        private void ResetBallToCenter()
        {
            if (m_BallBody == null)
            {
                return;
            }

            m_BallBody.position = Vector2.zero;
            m_BallBody.linearVelocity = Vector2.zero;
            m_BallBody.angularVelocity = 0f;
            m_BallStillTimer = 0f;
        }

        private void StopBall()
        {
            if (m_BallBody == null)
            {
                return;
            }

            m_BallBody.linearVelocity = Vector2.zero;
            m_BallBody.angularVelocity = 0f;
        }

        private string GetStatusMessage()
        {
            switch (m_Phase)
            {
                case MatchPhase.Setup:
                    return "Place 5 robot defenders on each half: 2 in front of the goal box, 1 in the middle of the penalty box, and 2 just outside the penalty box.";
                case MatchPhase.ReadyToShoot:
                    return GetTurnLabel() + " to shoot. Touch the ball, pull back, and release to flick.";
                case MatchPhase.Aiming:
                    return GetTurnLabel() + " is lining up a shot.";
                case MatchPhase.BallInMotion:
                    return "Ball in play. Turn changes when it settles.";
                case MatchPhase.GoalPause:
                    return (m_LastScoringSide == PlayerSide.Left ? "Blue" : "Orange") + " scores!";
                default:
                    return string.Empty;
            }
        }

        private string GetTurnLabel()
        {
            return m_CurrentTurn == PlayerSide.Left ? "Blue" : "Orange";
        }

        private int CountOccupied(List<DefenderSlot> slots)
        {
            var count = 0;
            for (var i = 0; i < slots.Count; i++)
            {
                if (slots[i].ContactId >= 0)
                {
                    count++;
                }
            }

            return count;
        }

        private bool AllSlotsOccupied()
        {
            return CountOccupied(m_LeftSlots) == m_LeftSlots.Count && CountOccupied(m_RightSlots) == m_RightSlots.Count;
        }

        private Vector2 ScreenToWorld(Vector2 boardScreenPosition, bool invertY = true)
        {
            if (m_WorldCamera == null)
            {
                return boardScreenPosition;
            }

            var y = invertY ? Screen.height - boardScreenPosition.y : boardScreenPosition.y;
            var screenPoint = new Vector3(boardScreenPosition.x, y, -m_WorldCamera.transform.position.z);
            return m_WorldCamera.ScreenToWorldPoint(screenPoint);
        }

        private void CreateWall(Transform parent, string name, Vector2 position, Vector2 size)
        {
            CreateQuad(parent, name + " Visual", position, size, kRailColor, -0.05f, -2);
            var wall = new GameObject(name);
            wall.transform.SetParent(parent, false);
            wall.transform.localPosition = new Vector3(position.x, position.y, 0f);
            var collider = wall.AddComponent<BoxCollider2D>();
            collider.size = size;
            collider.sharedMaterial = m_BouncyMaterial;
        }

        private GameObject CreateQuad(Transform parent, string name, Vector2 position, Vector2 size, Color color, float z, int sortingOrder)
        {
            var quad = new GameObject(name);
            quad.transform.SetParent(parent, false);
            quad.transform.localPosition = new Vector3(position.x, position.y, z);
            quad.transform.localScale = new Vector3(size.x, size.y, 1f);

            var renderer = quad.AddComponent<SpriteRenderer>();
            renderer.sprite = m_SquareSprite;
            renderer.color = color;
            renderer.sortingOrder = sortingOrder;

            return quad;
        }

        private GameObject CreateDisc(Transform parent, string name, Vector2 position, float diameter, Color color, int sortingOrder)
        {
            var disc = new GameObject(name);
            disc.transform.SetParent(parent, false);
            disc.transform.localPosition = new Vector3(position.x, position.y, 0f);
            disc.transform.localScale = Vector3.one * diameter;

            var renderer = disc.AddComponent<SpriteRenderer>();
            renderer.sprite = m_CircleSprite;
            renderer.color = color;
            renderer.sortingOrder = sortingOrder;

            return disc;
        }

        private void CreateRectangleLine(Transform parent, string name, Vector2 size, Color color, float width)
        {
            CreateRectangleLine(parent, name, size, color, width, Vector2.zero);
        }

        private void CreateRectangleLine(Transform parent, string name, Vector2 size, Color color, float width, Vector2 center)
        {
            var halfWidth = size.x * 0.5f;
            var halfHeight = size.y * 0.5f;
            CreateLine(parent, name, color, width, new[]
            {
                new Vector3(center.x - halfWidth, center.y - halfHeight, 0f),
                new Vector3(center.x - halfWidth, center.y + halfHeight, 0f),
                new Vector3(center.x + halfWidth, center.y + halfHeight, 0f),
                new Vector3(center.x + halfWidth, center.y - halfHeight, 0f),
                new Vector3(center.x - halfWidth, center.y - halfHeight, 0f),
            });
        }

        private LineRenderer CreateCircleLine(Transform parent, string name, Vector2 center, float radius, Color color, float width, int segments, float startDegrees, float endDegrees)
        {
            var points = new Vector3[segments + 1];
            for (var i = 0; i <= segments; i++)
            {
                var t = i / (float)segments;
                var angle = Mathf.Lerp(startDegrees, endDegrees, t) * Mathf.Deg2Rad;
                points[i] = new Vector3(center.x + (Mathf.Cos(angle) * radius), center.y + (Mathf.Sin(angle) * radius), 0f);
            }

            return CreateLine(parent, name, color, width, points);
        }

        private LineRenderer CreateLine(Transform parent, string name, Color color, float width, Vector3[] points)
        {
            var lineObject = new GameObject(name);
            lineObject.transform.SetParent(parent, false);

            var line = lineObject.AddComponent<LineRenderer>();
            line.material = m_SpriteMaterial;
            line.startColor = color;
            line.endColor = color;
            line.startWidth = width;
            line.endWidth = width;
            line.positionCount = points.Length;
            line.useWorldSpace = false;
            line.numCapVertices = 4;
            line.numCornerVertices = 4;
            line.sortingOrder = 1;
            line.SetPositions(points);
            return line;
        }

        private enum PlayerSide
        {
            Left,
            Right,
        }

        private enum MatchPhase
        {
            Setup,
            ReadyToShoot,
            Aiming,
            BallInMotion,
            GoalPause,
        }

        private sealed class DefenderSlot
        {
            public PlayerSide Side;
            public Vector2 Position;
            public int ContactId = -1;
            public GameObject SlotFill;
            public LineRenderer SlotOutline;
            public GameObject DefenderRoot;
            public SpriteRenderer DefenderRenderer;
            public CircleCollider2D DefenderCollider;

            public void SetOccupied(bool occupied)
            {
                var tint = Side == PlayerSide.Left ? kLeftColor : kRightColor;
                var fillRenderer = SlotFill.GetComponent<SpriteRenderer>();
                fillRenderer.color = occupied ? new Color(tint.r, tint.g, tint.b, 0.08f) : new Color(tint.r, tint.g, tint.b, 0.16f);
                SlotOutline.startColor = occupied ? new Color(1f, 1f, 1f, 0.4f) : new Color(1f, 1f, 1f, 0.92f);
                SlotOutline.endColor = SlotOutline.startColor;
                DefenderRoot.SetActive(occupied);
                DefenderCollider.enabled = occupied;
            }
        }

        private struct ContactWorldState
        {
            public int ContactId;
            public Vector2 WorldPosition;
        }
    }
}
