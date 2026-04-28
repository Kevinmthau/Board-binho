namespace BoardBinho
{
    using System.Collections.Generic;

    using Board.Core;
    using Board.Input;

    using UnityEngine;

    [DisallowMultipleComponent]
    public sealed class BinhoGameController : MonoBehaviour
    {
        private const float kFieldWidth = 16f;
        private const float kFieldHeight = 9f;
        private const float kFieldScreenFill = 0.94f;
        private const string kFieldBackgroundResourcePath = "Binho/field_background";
        private const float kFieldBackgroundPixelsPerUnit = 100f;
        private const float kFieldBackgroundPixelWidth = 1536f;
        private const float kFieldBackgroundPixelHeight = 1024f;
        private const int kDefendersPerSide = 7;
        private const float kOffBoardGoalClearance = 0.22f;
        private const float kFieldLineInset = 0.08f;
        private const float kWallThickness = 0.22f;
        private const float kGoalDepth = 0.9f;
        private const float kGoalHalfHeight = 0.86f;
        private const float kGoalBoxDepth = 1.22f;
        private const float kGoalBoxHalfHeight = 0.98f;
        private const float kPenaltyBoxDepth = 2.7f;
        private const float kPenaltyBoxHalfHeight = 1.82f;
        private const float kCenterCircleRadius = 1.35f;
        private const float kPenaltyArcRadius = 0.58f;
        private const float kPenaltyMarkDistance = 1.88f;
        private const float kCornerArcRadius = 0.34f;
        private const float kDefenderRadius = 0.32f;
        private const float kSlotSnapRadius = 0.95f;
        private const float kBallRadius = 0.2f;
        private const float kBallSwipeCaptureRadius = 0.55f;
        private const float kMinSwipeTravelDistance = 0.05f;
        private const float kMinSwipeSpeed = 2.5f;
        private const float kMaxSwipeSpeed = 22f;
        private const float kMinShotImpulse = 2.4f;
        private const float kMaxShotImpulse = 14.5f;
        private const float kBallRestVelocity = 0.35f;
        private const float kBallRestTime = 0.1f;
        private const float kGoalPauseDuration = 1.15f;

        private static readonly Color kFieldColor = new Color(0.09f, 0.35f, 0.18f);
        private static readonly Color kFieldInnerTint = new Color(0.13f, 0.42f, 0.23f);
        private static readonly Color kFieldEdgeColor = new Color(0.04f, 0.18f, 0.08f);
        private static readonly Color kBackgroundColor = new Color(0.9f, 0.93f, 0.91f);
        private static readonly Color kLineColor = new Color(0.96f, 0.96f, 0.94f);
        private static readonly Color kLeftColor = new Color(0.22f, 0.73f, 0.98f);
        private static readonly Color kRightColor = new Color(0.98f, 0.66f, 0.18f);
        private static readonly Color kBallColor = new Color(0.98f, 0.98f, 0.98f);
        private static readonly Color kShadowColor = new Color(0f, 0f, 0f, 0.18f);

        [SerializeField] private Camera m_WorldCamera;
        private readonly List<DefenderSlot> m_LeftSlots = new List<DefenderSlot>();
        private readonly List<DefenderSlot> m_RightSlots = new List<DefenderSlot>();
        private readonly List<DefenderSlot> m_AllSlots = new List<DefenderSlot>();
        private readonly Dictionary<int, SwipeContactState> m_BoardSwipeContacts = new Dictionary<int, SwipeContactState>();
        private readonly List<int> m_ExpiredBoardSwipeContacts = new List<int>();

        private Material m_SpriteMaterial;
        private Sprite m_SquareSprite;
        private Sprite m_CircleSprite;
        private Sprite m_FieldBackgroundSprite;
        private PhysicsMaterial2D m_BouncyMaterial;

        private Rigidbody2D m_BallBody;
        private SpriteRenderer m_BallRenderer;
        private LineRenderer m_AimLine;

        private MatchPhase m_Phase = MatchPhase.Setup;
        private PlayerSide m_CurrentTurn = PlayerSide.Left;
        private PlayerSide m_LastScoringSide = PlayerSide.Left;
        private int m_LeftScore;
        private int m_RightScore;
        private float m_BallStillTimer;
        private float m_GoalPauseTimer;
        private bool m_DidServeInitialKickoff;
        private float BaseFieldHalfWidth => kFieldWidth * 0.5f;
        private float BaseFieldHalfHeight => kFieldHeight * 0.5f;
        private float ScreenHalfWidth => m_WorldCamera != null && m_WorldCamera.orthographic ? m_WorldCamera.orthographicSize * m_WorldCamera.aspect : BaseFieldHalfWidth;
        private float ScreenHalfHeight => m_WorldCamera != null && m_WorldCamera.orthographic ? m_WorldCamera.orthographicSize : BaseFieldHalfHeight;
        private float GoalDisplayHalfWidth => BaseFieldHalfWidth + kGoalDepth + kWallThickness + kOffBoardGoalClearance;
        private float UniformFieldScale => Mathf.Min(ScreenHalfWidth / GoalDisplayHalfWidth, ScreenHalfHeight / BaseFieldHalfHeight) * kFieldScreenFill;
        private float PitchHalfWidth => BaseFieldHalfWidth * UniformFieldScale;
        private float PitchHalfHeight => BaseFieldHalfHeight * UniformFieldScale;
        private float HorizontalFieldScale => UniformFieldScale;
        private float VerticalFieldScale => UniformFieldScale;
        private float FieldLineInset => Scale(kFieldLineInset);
        private float WallThickness => Scale(kWallThickness);
        private float GoalDepth => ScaleX(kGoalDepth);
        private float GoalHalfHeight => ScaleY(kGoalHalfHeight);
        private float GoalBoxDepth => ScaleX(kGoalBoxDepth);
        private float GoalBoxHalfHeight => ScaleY(kGoalBoxHalfHeight);
        private float PenaltyBoxDepth => ScaleX(kPenaltyBoxDepth);
        private float PenaltyBoxHalfHeight => ScaleY(kPenaltyBoxHalfHeight);
        private float CenterCircleRadius => Scale(kCenterCircleRadius);
        private float PenaltyArcRadius => Scale(kPenaltyArcRadius);
        private float PenaltyMarkDistance => ScaleX(kPenaltyMarkDistance);
        private float CornerArcRadius => Scale(kCornerArcRadius);
        private float DefenderRadius => Scale(kDefenderRadius);
        private float SlotSnapRadius => Scale(kSlotSnapRadius);
        private float BallRadius => Scale(kBallRadius);
        private float BallSwipeCaptureRadius => Scale(kBallSwipeCaptureRadius);
        private float MinSwipeTravelDistance => Scale(kMinSwipeTravelDistance);
        private float MinSwipeSpeed => Scale(kMinSwipeSpeed);
        private float MaxSwipeSpeed => Scale(kMaxSwipeSpeed);
        private float MinShotImpulse => Scale(kMinShotImpulse);
        private float MaxShotImpulse => Scale(kMaxShotImpulse);
        private float BallRestVelocity => Scale(kBallRestVelocity);
        private float GoalScoreDepth => Mathf.Max(BallRadius * 0.6f, GoalDepth * 0.2f);

        private float ScaleX(float value)
        {
            return value * HorizontalFieldScale;
        }

        private float ScaleY(float value)
        {
            return value * VerticalFieldScale;
        }

        private float Scale(float value)
        {
            return value * UniformFieldScale;
        }

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

            var placementText = $"Blue defenders: {CountOccupied(m_LeftSlots)}/{m_LeftSlots.Count}    Orange defenders: {CountOccupied(m_RightSlots)}/{m_RightSlots.Count}";
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

            if (m_FieldBackgroundSprite == null)
            {
                var fieldTexture = LoadFieldBackgroundTexture();
                if (fieldTexture != null)
                {
                    m_FieldBackgroundSprite = Sprite.Create(
                        fieldTexture,
                        new Rect(0f, 0f, fieldTexture.width, fieldTexture.height),
                        new Vector2(0.5f, 0.5f),
                        kFieldBackgroundPixelsPerUnit);
                }
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

        private static Texture2D LoadFieldBackgroundTexture()
        {
            var fieldTexture = Resources.Load<Texture2D>(kFieldBackgroundResourcePath);
            if (fieldTexture != null)
            {
                return fieldTexture;
            }

            var fieldSprites = Resources.LoadAll<Sprite>(kFieldBackgroundResourcePath);
            return fieldSprites.Length > 0 ? fieldSprites[0].texture : null;
        }

        private void BuildPlayfield()
        {
            var fieldRoot = new GameObject("Binho Field");
            fieldRoot.transform.SetParent(transform, false);

            ConfigureCamera();

            var boardSurfaceSize = new Vector2(PitchHalfWidth * 2f, PitchHalfHeight * 2f);
            var hasFieldBackground = m_FieldBackgroundSprite != null;
            if (hasFieldBackground)
            {
                var screenSurfaceSize = new Vector2(ScreenHalfWidth * 2f, ScreenHalfHeight * 2f);
                CreateSpriteQuad(fieldRoot.transform, "Field Background", Vector2.zero, screenSurfaceSize, m_FieldBackgroundSprite, Color.white, -0.13f, -6);
            }
            else
            {
                CreateQuad(fieldRoot.transform, "Field Edge", Vector2.zero, boardSurfaceSize + (Vector2.one * Scale(0.22f)), kFieldEdgeColor, -0.12f, -5);
                CreateQuad(fieldRoot.transform, "Field Surface", Vector2.zero, boardSurfaceSize, kFieldColor, -0.1f, -4);
                CreateQuad(fieldRoot.transform, "Field Wash", Vector2.zero, boardSurfaceSize, new Color(kFieldInnerTint.r, kFieldInnerTint.g, kFieldInnerTint.b, 0.48f), -0.09f, -3);
            }

            BuildWalls(fieldRoot.transform);
            if (!hasFieldBackground)
            {
                BuildFieldLines(fieldRoot.transform);
            }

            BuildSlots(fieldRoot.transform);
            BuildBall(fieldRoot.transform);
        }

        private void BuildWalls(Transform parent)
        {
            var upperWallHeight = PitchHalfHeight - GoalHalfHeight;
            var upperWallCenterY = GoalHalfHeight + (upperWallHeight * 0.5f);
            var sideWallX = PitchHalfWidth + (WallThickness * 0.5f);
            var goalBackX = PitchHalfWidth + GoalDepth + (WallThickness * 0.5f);
            var goalInteriorX = PitchHalfWidth + (GoalDepth * 0.5f);

            CreateWall(parent, "Top Wall", new Vector2(0f, PitchHalfHeight + (WallThickness * 0.5f)), new Vector2(PitchHalfWidth * 2f, WallThickness));
            CreateWall(parent, "Bottom Wall", new Vector2(0f, -PitchHalfHeight - (WallThickness * 0.5f)), new Vector2(PitchHalfWidth * 2f, WallThickness));

            CreateWall(parent, "Left Upper Wall", new Vector2(-sideWallX, upperWallCenterY), new Vector2(WallThickness, upperWallHeight));
            CreateWall(parent, "Left Lower Wall", new Vector2(-sideWallX, -upperWallCenterY), new Vector2(WallThickness, upperWallHeight));
            CreateWall(parent, "Right Upper Wall", new Vector2(sideWallX, upperWallCenterY), new Vector2(WallThickness, upperWallHeight));
            CreateWall(parent, "Right Lower Wall", new Vector2(sideWallX, -upperWallCenterY), new Vector2(WallThickness, upperWallHeight));

            CreateWall(parent, "Left Goal Back", new Vector2(-goalBackX, 0f), new Vector2(WallThickness, GoalHalfHeight * 2f));
            CreateWall(parent, "Right Goal Back", new Vector2(goalBackX, 0f), new Vector2(WallThickness, GoalHalfHeight * 2f));
            CreateWall(parent, "Left Goal Roof", new Vector2(-goalInteriorX, GoalHalfHeight + (WallThickness * 0.5f)), new Vector2(GoalDepth, WallThickness));
            CreateWall(parent, "Left Goal Floor", new Vector2(-goalInteriorX, -GoalHalfHeight - (WallThickness * 0.5f)), new Vector2(GoalDepth, WallThickness));
            CreateWall(parent, "Right Goal Roof", new Vector2(goalInteriorX, GoalHalfHeight + (WallThickness * 0.5f)), new Vector2(GoalDepth, WallThickness));
            CreateWall(parent, "Right Goal Floor", new Vector2(goalInteriorX, -GoalHalfHeight - (WallThickness * 0.5f)), new Vector2(GoalDepth, WallThickness));
        }

        private void BuildFieldLines(Transform parent)
        {
            var lineRoot = new GameObject("Field Lines");
            lineRoot.transform.SetParent(parent, false);

            BuildBoundaryLines(lineRoot.transform);

            CreateLine(lineRoot.transform, "Halfway", kLineColor, Scale(0.06f), new[]
            {
                new Vector3(0f, -PitchHalfHeight + FieldLineInset, 0f),
                new Vector3(0f, PitchHalfHeight - FieldLineInset, 0f),
            });

            CreateCircleLine(lineRoot.transform, "Center Circle", Vector2.zero, CenterCircleRadius, kLineColor, Scale(0.06f), 48, 0f, 360f);
            CreateDisc(parent, "Center Spot", Vector2.zero, Scale(0.09f), kLineColor, 4);

            BuildGoalSideLines(lineRoot.transform, false);
            BuildGoalSideLines(lineRoot.transform, true);
        }

        private void BuildBoundaryLines(Transform parent)
        {
            var leftX = -PitchHalfWidth + FieldLineInset;
            var rightX = PitchHalfWidth - FieldLineInset;
            var topY = PitchHalfHeight - FieldLineInset;
            var bottomY = -PitchHalfHeight + FieldLineInset;
            var goalLineGap = GoalBoxHalfHeight;
            var lineWidth = Scale(0.06f);

            CreateLine(parent, "Top Sideline", kLineColor, lineWidth, new[]
            {
                new Vector3(leftX + CornerArcRadius, topY, 0f),
                new Vector3(rightX - CornerArcRadius, topY, 0f),
            });
            CreateLine(parent, "Bottom Sideline", kLineColor, lineWidth, new[]
            {
                new Vector3(leftX + CornerArcRadius, bottomY, 0f),
                new Vector3(rightX - CornerArcRadius, bottomY, 0f),
            });

            CreateLine(parent, "Left Goal Line Upper", kLineColor, lineWidth, new[]
            {
                new Vector3(leftX, goalLineGap, 0f),
                new Vector3(leftX, topY - CornerArcRadius, 0f),
            });
            CreateLine(parent, "Left Goal Line Lower", kLineColor, lineWidth, new[]
            {
                new Vector3(leftX, bottomY + CornerArcRadius, 0f),
                new Vector3(leftX, -goalLineGap, 0f),
            });
            CreateLine(parent, "Right Goal Line Upper", kLineColor, lineWidth, new[]
            {
                new Vector3(rightX, goalLineGap, 0f),
                new Vector3(rightX, topY - CornerArcRadius, 0f),
            });
            CreateLine(parent, "Right Goal Line Lower", kLineColor, lineWidth, new[]
            {
                new Vector3(rightX, bottomY + CornerArcRadius, 0f),
                new Vector3(rightX, -goalLineGap, 0f),
            });

            CreateCircleLine(parent, "Top Left Corner", new Vector2(leftX + CornerArcRadius, topY - CornerArcRadius), CornerArcRadius, kLineColor, lineWidth, 10, 90f, 180f);
            CreateCircleLine(parent, "Bottom Left Corner", new Vector2(leftX + CornerArcRadius, bottomY + CornerArcRadius), CornerArcRadius, kLineColor, lineWidth, 10, 180f, 270f);
            CreateCircleLine(parent, "Top Right Corner", new Vector2(rightX - CornerArcRadius, topY - CornerArcRadius), CornerArcRadius, kLineColor, lineWidth, 10, 0f, 90f);
            CreateCircleLine(parent, "Bottom Right Corner", new Vector2(rightX - CornerArcRadius, bottomY + CornerArcRadius), CornerArcRadius, kLineColor, lineWidth, 10, 270f, 360f);
        }

        private void BuildGoalSideLines(Transform parent, bool isRightSide)
        {
            var direction = isRightSide ? 1f : -1f;
            var sideName = isRightSide ? "Right" : "Left";
            var fieldX = direction * (PitchHalfWidth - FieldLineInset);
            var goalBoxFrontX = fieldX - (direction * GoalBoxDepth);
            var penaltyBoxFrontX = fieldX - (direction * PenaltyBoxDepth);
            var penaltyMarkX = fieldX - (direction * PenaltyMarkDistance);

            CreateOpenGoalAreaLine(
                parent,
                sideName + " Goal Box",
                fieldX,
                goalBoxFrontX,
                GoalBoxHalfHeight,
                kLineColor,
                Scale(0.06f));

            CreateOpenGoalAreaLine(
                parent,
                sideName + " Penalty Box",
                fieldX,
                penaltyBoxFrontX,
                PenaltyBoxHalfHeight,
                kLineColor,
                Scale(0.06f));

            BuildOffBoardGoalLines(parent, sideName, direction, fieldX);

            CreateDisc(parent.parent, sideName + " Penalty Spot", new Vector2(penaltyMarkX, 0f), Scale(0.08f), kLineColor, 4);

            if (isRightSide)
            {
                CreateCircleLine(parent, sideName + " Penalty Arc", new Vector2(penaltyMarkX, 0f), PenaltyArcRadius, kLineColor, Scale(0.05f), 20, 125f, 235f);
            }
            else
            {
                CreateCircleLine(parent, sideName + " Penalty Arc", new Vector2(penaltyMarkX, 0f), PenaltyArcRadius, kLineColor, Scale(0.05f), 20, -55f, 55f);
            }
        }

        private void CreateOpenGoalAreaLine(Transform parent, string name, float goalLineX, float frontX, float halfHeight, Color color, float width)
        {
            CreateLine(parent, name, color, width, new[]
            {
                new Vector3(goalLineX, halfHeight, 0f),
                new Vector3(frontX, halfHeight, 0f),
                new Vector3(frontX, -halfHeight, 0f),
                new Vector3(goalLineX, -halfHeight, 0f),
            });
        }

        private void BuildOffBoardGoalLines(Transform parent, string sideName, float direction, float fieldX)
        {
            var backX = direction * (PitchHalfWidth + GoalDepth);
            var frameColor = new Color(kLineColor.r, kLineColor.g, kLineColor.b, 0.96f);
            var netColor = new Color(kLineColor.r, kLineColor.g, kLineColor.b, 0.42f);
            var frameWidth = Scale(0.08f);
            var netWidth = Scale(0.035f);

            CreateLine(parent, sideName + " Off Board Goal Frame", frameColor, frameWidth, new[]
            {
                new Vector3(fieldX, GoalHalfHeight, 0f),
                new Vector3(backX, GoalHalfHeight, 0f),
                new Vector3(backX, -GoalHalfHeight, 0f),
                new Vector3(fieldX, -GoalHalfHeight, 0f),
            });

            for (var i = 1; i <= 3; i++)
            {
                var t = i * 0.25f;
                var x = Mathf.Lerp(fieldX, backX, t);
                CreateLine(parent, sideName + " Goal Net Rib " + i, netColor, netWidth, new[]
                {
                    new Vector3(x, GoalHalfHeight, 0f),
                    new Vector3(x, -GoalHalfHeight, 0f),
                });
            }

            for (var i = 1; i <= 2; i++)
            {
                var y = Mathf.Lerp(-GoalHalfHeight, GoalHalfHeight, i / 3f);
                CreateLine(parent, sideName + " Goal Net Strand " + i, netColor, netWidth, new[]
                {
                    new Vector3(fieldX, y, 0f),
                    new Vector3(backX, y, 0f),
                });
            }
        }

        private void BuildSlots(Transform parent)
        {
            var slotRoot = new GameObject("Defender Slots");
            slotRoot.transform.SetParent(parent, false);

            var leftSlotPositions = new[]
            {
                FieldBackgroundPixelToWorld(180f, 160f),
                FieldBackgroundPixelToWorld(113f, 343f),
                FieldBackgroundPixelToWorld(222f, 500f),
                FieldBackgroundPixelToWorld(113f, 641f),
                FieldBackgroundPixelToWorld(180f, 816f),
                FieldBackgroundPixelToWorld(376f, 405f),
                FieldBackgroundPixelToWorld(376f, 585f),
            };

            for (var i = 0; i < leftSlotPositions.Length; i++)
            {
                CreateSlot(slotRoot.transform, PlayerSide.Left, $"Left Slot {i + 1}", leftSlotPositions[i]);
                CreateSlot(slotRoot.transform, PlayerSide.Right, $"Right Slot {i + 1}", new Vector2(-leftSlotPositions[i].x, leftSlotPositions[i].y));
            }
        }

        private Vector2 FieldBackgroundPixelToWorld(float x, float y)
        {
            return new Vector2(
                Mathf.Lerp(-ScreenHalfWidth, ScreenHalfWidth, x / kFieldBackgroundPixelWidth),
                Mathf.Lerp(ScreenHalfHeight, -ScreenHalfHeight, y / kFieldBackgroundPixelHeight));
        }

        private void ConfigureCamera()
        {
            if (m_WorldCamera == null)
            {
                return;
            }

            m_WorldCamera.orthographic = true;
            m_WorldCamera.orthographicSize = 5.5f;
            m_WorldCamera.transform.position = new Vector3(0f, 0f, -10f);
            m_WorldCamera.backgroundColor = kBackgroundColor;
        }

        private void BuildBall(Transform parent)
        {
            var ballShadow = CreateDisc(parent, "Ball Shadow", new Vector2(ScaleX(0.05f), -ScaleY(0.07f)), BallRadius * 2.25f, kShadowColor, 7);
            ballShadow.transform.localScale = new Vector3(1.15f, 0.7f, 1f);

            var ball = new GameObject("Ball");
            ball.transform.SetParent(parent, false);
            ball.transform.localPosition = new Vector3(0f, 0f, 0f);

            m_BallRenderer = ball.AddComponent<SpriteRenderer>();
            m_BallRenderer.sprite = m_CircleSprite;
            m_BallRenderer.color = kBallColor;
            m_BallRenderer.sortingOrder = 8;
            ball.transform.localScale = Vector3.one * (BallRadius * 2f);

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
            trail.startWidth = Scale(0.16f);
            trail.endWidth = Scale(0.04f);
            trail.sortingOrder = 7;

            var aim = new GameObject("Aim Line");
            aim.transform.SetParent(parent, false);
            m_AimLine = aim.AddComponent<LineRenderer>();
            m_AimLine.material = m_SpriteMaterial;
            m_AimLine.positionCount = 2;
            m_AimLine.startWidth = Scale(0.07f);
            m_AimLine.endWidth = Scale(0.02f);
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

            GameObject fill = null;
            LineRenderer outline = null;
            if (m_FieldBackgroundSprite == null)
            {
                fill = CreateDisc(slotRoot.transform, "Slot Fill", Vector2.zero, DefenderRadius * 2.45f, side == PlayerSide.Left ? new Color(kLeftColor.r, kLeftColor.g, kLeftColor.b, 0.16f) : new Color(kRightColor.r, kRightColor.g, kRightColor.b, 0.16f), 2);
                outline = CreateCircleLine(slotRoot.transform, "Slot Outline", Vector2.zero, DefenderRadius * 1.25f, kLineColor, Scale(0.05f), 28, 0f, 360f);
            }

            var defender = new GameObject("Defender");
            defender.transform.SetParent(slotRoot.transform, false);
            defender.transform.localScale = Vector3.one * (DefenderRadius * 2f);

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
                    if (distance > SlotSnapRadius || distance >= bestDistance)
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

            TryCompleteShotTurnIfSettled();
            HandleBoardFingerShotInput();
        }

        private void HandleBoardFingerShotInput()
        {
            var fingers = BoardInput.GetActiveContacts(BoardContactType.Finger);
            m_ExpiredBoardSwipeContacts.Clear();

            for (var i = 0; i < fingers.Length; i++)
            {
                var contact = fingers[i];
                var worldPosition = ScreenToWorld(contact.screenPosition);
                var timestamp = contact.timestamp;

                if (!m_BoardSwipeContacts.TryGetValue(contact.contactId, out var swipeContact))
                {
                    m_BoardSwipeContacts[contact.contactId] = new SwipeContactState
                    {
                        WorldPosition = worldPosition,
                        Timestamp = timestamp,
                    };
                    continue;
                }

                if (TryLaunchSwipe(
                    swipeContact.WorldPosition,
                    worldPosition,
                    Mathf.Max((float)(timestamp - swipeContact.Timestamp), 1f / 240f)))
                {
                    return;
                }

                m_BoardSwipeContacts[contact.contactId] = new SwipeContactState
                {
                    WorldPosition = worldPosition,
                    Timestamp = timestamp,
                };
            }

            foreach (var contactId in m_BoardSwipeContacts.Keys)
            {
                var contactStillActive = false;
                for (var i = 0; i < fingers.Length; i++)
                {
                    if (fingers[i].contactId == contactId)
                    {
                        contactStillActive = true;
                        break;
                    }
                }

                if (!contactStillActive)
                {
                    m_ExpiredBoardSwipeContacts.Add(contactId);
                }
            }

            for (var i = 0; i < m_ExpiredBoardSwipeContacts.Count; i++)
            {
                m_BoardSwipeContacts.Remove(m_ExpiredBoardSwipeContacts[i]);
            }
        }

        private void CancelActiveShot()
        {
            m_BoardSwipeContacts.Clear();
            m_ExpiredBoardSwipeContacts.Clear();
            if (m_AimLine != null)
            {
                m_AimLine.enabled = false;
            }
        }

        private bool CanLaunchSwipe()
        {
            if (m_Phase == MatchPhase.Setup || m_Phase == MatchPhase.GoalPause)
            {
                return false;
            }

            if (!AllSlotsOccupied())
            {
                return false;
            }

            if (m_BallBody == null)
            {
                return false;
            }

            if (!IsBallSlowEnoughForNextShot())
            {
                return false;
            }

            TryCompleteShotTurnIfSettled();
            return m_Phase == MatchPhase.ReadyToShoot;
        }

        private bool TryLaunchSwipe(Vector2 previousWorldPosition, Vector2 currentWorldPosition, float deltaTime)
        {
            if (!CanLaunchSwipe())
            {
                return false;
            }

            var swipeVector = currentWorldPosition - previousWorldPosition;
            var swipeDistance = swipeVector.magnitude;
            if (swipeDistance < MinSwipeTravelDistance)
            {
                return false;
            }

            if (DistanceFromPointToSegment(m_BallBody.position, previousWorldPosition, currentWorldPosition) > BallSwipeCaptureRadius)
            {
                return false;
            }

            var swipeSpeed = swipeDistance / Mathf.Max(deltaTime, 1f / 240f);
            if (swipeSpeed < MinSwipeSpeed)
            {
                return false;
            }

            var swipeStrength = Mathf.InverseLerp(MinSwipeSpeed, MaxSwipeSpeed, swipeSpeed);
            var impulseMagnitude = Mathf.Lerp(MinShotImpulse, MaxShotImpulse, swipeStrength);
            LaunchShot(swipeVector.normalized * impulseMagnitude);
            return true;
        }

        private void LaunchShot(Vector2 impulse)
        {
            if (m_BallBody == null)
            {
                return;
            }

            CancelActiveShot();
            m_BallBody.linearVelocity = Vector2.zero;
            m_BallBody.angularVelocity = 0f;
            m_BallBody.AddForce(impulse, ForceMode2D.Impulse);
            m_Phase = MatchPhase.BallInMotion;
            m_BallStillTimer = 0f;
        }

        private bool IsBallSlowEnoughForNextShot()
        {
            return m_BallBody != null && m_BallBody.linearVelocity.sqrMagnitude <= BallRestVelocity * BallRestVelocity;
        }

        private void CompleteShotTurn()
        {
            if (m_BallBody == null)
            {
                return;
            }

            CancelActiveShot();
            StopBall();
            m_BallStillTimer = 0f;
            m_CurrentTurn = m_CurrentTurn == PlayerSide.Left ? PlayerSide.Right : PlayerSide.Left;
            m_Phase = MatchPhase.ReadyToShoot;
        }

        private void TryCompleteShotTurnIfSettled()
        {
            if (m_Phase != MatchPhase.BallInMotion || m_BallStillTimer < kBallRestTime)
            {
                return;
            }

            CompleteShotTurn();
        }

        private void UpdateAimLine()
        {
            if (m_AimLine == null)
            {
                return;
            }

            m_AimLine.enabled = false;
        }

        private void UpdateBallMotionState()
        {
            if (m_BallBody == null || m_Phase == MatchPhase.Setup || m_Phase == MatchPhase.GoalPause)
            {
                return;
            }

            if (m_Phase != MatchPhase.BallInMotion)
            {
                m_BallStillTimer = 0f;
                return;
            }

            if (IsBallSlowEnoughForNextShot())
            {
                m_BallStillTimer += Time.fixedDeltaTime;
            }
            else
            {
                m_BallStillTimer = 0f;
            }

            TryCompleteShotTurnIfSettled();
        }

        private void CheckForGoal()
        {
            if (m_BallBody == null || m_Phase == MatchPhase.GoalPause)
            {
                return;
            }

            var position = m_BallBody.position;
            if (Mathf.Abs(position.y) > GoalHalfHeight - ScaleY(0.05f))
            {
                return;
            }

            if (position.x <= -PitchHalfWidth - GoalScoreDepth)
            {
                RegisterGoal(PlayerSide.Right);
            }
            else if (position.x >= PitchHalfWidth + GoalScoreDepth)
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
                    return "Place " + kDefendersPerSide + " robot defenders on each half, one on each gray placement spot.";
                case MatchPhase.ReadyToShoot:
                    return GetTurnLabel() + " to shoot. Swipe across the ball in the direction you want it to travel; faster swipes hit harder.";
                case MatchPhase.Aiming:
                    return GetTurnLabel() + " is lining up the next flick.";
                case MatchPhase.BallInMotion:
                    return "Ball in play. The next player can flick as soon as it settles.";
                case MatchPhase.GoalPause:
                    return (m_LastScoringSide == PlayerSide.Left ? "Blue" : "Orange") + " scores!";
                default:
                    return string.Empty;
            }
        }

        private static float DistanceFromPointToSegment(Vector2 point, Vector2 segmentStart, Vector2 segmentEnd)
        {
            var segment = segmentEnd - segmentStart;
            var segmentLengthSquared = segment.sqrMagnitude;
            if (segmentLengthSquared <= Mathf.Epsilon)
            {
                return Vector2.Distance(point, segmentStart);
            }

            var projection = Vector2.Dot(point - segmentStart, segment) / segmentLengthSquared;
            projection = Mathf.Clamp01(projection);
            var closestPoint = segmentStart + (segment * projection);
            return Vector2.Distance(point, closestPoint);
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
            var wall = new GameObject(name);
            wall.transform.SetParent(parent, false);
            wall.transform.localPosition = new Vector3(position.x, position.y, 0f);
            var collider = wall.AddComponent<BoxCollider2D>();
            collider.size = size;
            collider.sharedMaterial = m_BouncyMaterial;
        }

        private GameObject CreateQuad(Transform parent, string name, Vector2 position, Vector2 size, Color color, float z, int sortingOrder)
        {
            return CreateSpriteQuad(parent, name, position, size, m_SquareSprite, color, z, sortingOrder);
        }

        private GameObject CreateSpriteQuad(Transform parent, string name, Vector2 position, Vector2 size, Sprite sprite, Color color, float z, int sortingOrder)
        {
            var quad = new GameObject(name);
            quad.transform.SetParent(parent, false);
            quad.transform.localPosition = new Vector3(position.x, position.y, z);

            var renderer = quad.AddComponent<SpriteRenderer>();
            renderer.sprite = sprite;
            renderer.color = color;
            renderer.sortingOrder = sortingOrder;

            var spriteSize = sprite != null ? sprite.bounds.size : Vector3.one;
            quad.transform.localScale = new Vector3(
                spriteSize.x > Mathf.Epsilon ? size.x / spriteSize.x : size.x,
                spriteSize.y > Mathf.Epsilon ? size.y / spriteSize.y : size.y,
                1f);

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
                if (SlotFill != null)
                {
                    var fillRenderer = SlotFill.GetComponent<SpriteRenderer>();
                    fillRenderer.color = occupied ? new Color(tint.r, tint.g, tint.b, 0.08f) : new Color(tint.r, tint.g, tint.b, 0.16f);
                }

                if (SlotOutline != null)
                {
                    SlotOutline.startColor = occupied ? new Color(1f, 1f, 1f, 0.4f) : new Color(1f, 1f, 1f, 0.92f);
                    SlotOutline.endColor = SlotOutline.startColor;
                }

                DefenderRoot.SetActive(occupied);
                DefenderCollider.enabled = occupied;
            }
        }

        private struct ContactWorldState
        {
            public int ContactId;
            public Vector2 WorldPosition;
        }

        private struct SwipeContactState
        {
            public Vector2 WorldPosition;
            public double Timestamp;
        }
    }
}
